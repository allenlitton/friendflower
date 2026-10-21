import "server-only";
import { connect } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

// Sends notifications to iPhones through Apple's push service (APNs), using a token-based
// .p8 key. Needs APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY (the .p8 file's text);
// APNS_TOPIC defaults to the app's bundle id.

export type PushToken = { token: string; env: "production" | "sandbox" | null };
export type PushMessage = { title: string; body: string; url: string };
export type PushOutcome = { token: string; env: "production" | "sandbox" | null; dead: boolean };

const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" } as const;
const TOPIC = process.env.APNS_TOPIC ?? "app.friendflower.ios";

export function apnsConfigured() {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// Apple wants a fresh-ish JWT: reuse one for 40 minutes (it must be renewed within 60).
let cached: { jwt: string; at: number } | null = null;
function jwt() {
  if (cached && Date.now() - cached.at < 40 * 60_000) return cached.jwt;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const key = createPrivateKey(process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n"));
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  cached = { jwt: `${header}.${claims}.${b64url(sig)}`, at: Date.now() };
  return cached.jwt;
}

type Reply = { status: number; reason?: string };

function post(host: string, token: string, payload: string): Promise<Reply> {
  return new Promise((resolve) => {
    const client = connect(host);
    const done = (r: Reply) => { client.close(); resolve(r); };
    client.on("error", () => done({ status: 0, reason: "ConnectionFailed" }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt()}`,
      "apns-topic": TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    req.setTimeout(10_000, () => { req.close(); done({ status: 0, reason: "Timeout" }); });
    let data = "";
    let status = 0;
    req.on("response", (h) => { status = Number(h[":status"]); });
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      let reason: string | undefined;
      try { reason = JSON.parse(data).reason; } catch {}
      done({ status, reason });
    });
    req.on("error", () => done({ status: 0, reason: "RequestFailed" }));
    req.end(payload);
  });
}

/**
 * Tries the gateway this token last worked on (production if unknown), then the other one,
 * because a build run from Xcode gets a sandbox token and a TestFlight/App Store build a
 * production one. Only a token Apple says is invalid on both is reported dead.
 */
export async function sendPush(t: PushToken, m: PushMessage): Promise<PushOutcome> {
  const payload = JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: "default" }, url: m.url });
  const order = t.env === "sandbox" ? (["sandbox", "production"] as const) : (["production", "sandbox"] as const);
  let wrongToken = 0;
  for (const env of order) {
    const r = await post(HOSTS[env], t.token, payload);
    if (r.status === 200) return { token: t.token, env, dead: false };
    if (r.reason === "BadDeviceToken" || r.reason === "DeviceTokenNotForTopic") { wrongToken++; continue; }
    if (r.reason === "Unregistered" || r.reason === "ExpiredToken") return { token: t.token, env: t.env, dead: true };
    return { token: t.token, env: t.env, dead: false }; // Apple or the network hiccuped: keep the token
  }
  return { token: t.token, env: t.env, dead: wrongToken === 2 };
}
