// Connects Fo Concierge to the shared Wajo account, once.
// Run with: npm run fo:connect   (reads .env.local)
//
// Registers Friend Flower with Fo, opens the Wajo sign-in in your browser,
// and saves the resulting tokens in the database (private.fo_auth). Every
// member's Fo Concierge requests then run from the account you sign in with.
// Run it again any time to switch accounts or reconnect.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const FO_URL = "https://mcp.api.wajo.ai/fo";
const AUTH = "https://mcp.api.wajo.ai";
const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const reg = await fetch(`${AUTH}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "Friend Flower", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], token_endpoint_auth_method: "none", scope: "mcp",
  }),
});
if (!reg.ok) throw new Error(`Registering with Fo failed: ${reg.status} ${await reg.text()}`);
const { client_id: clientId } = await reg.json();

const b64url = (b) => b.toString("base64url");
const verifier = b64url(randomBytes(32));
const state = b64url(randomBytes(16));
const authorize = new URL(`${AUTH}/oauth/authorize`);
authorize.search = new URLSearchParams({
  response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "mcp", state, resource: FO_URL,
  code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
}).toString();

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const q = new URL(req.url, REDIRECT).searchParams;
    if (!req.url.startsWith("/callback")) { res.writeHead(404).end(); return; }
    const ok = q.get("state") === state && q.get("code");
    res.writeHead(ok ? 200 : 400, { "content-type": "text/plain" })
      .end(ok ? "Fo is connected to Friend Flower. You can close this tab." : `Sign-in didn't finish: ${q.get("error") ?? "unknown error"}`);
    server.close();
    if (ok) resolve(q.get("code"));
    else reject(new Error(q.get("error_description") ?? q.get("error") ?? "Sign-in failed"));
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Sign in to the Wajo account Fo Concierge should use:\n\n  ${authorize}\n`);
    spawn(process.platform === "darwin" ? "open" : "xdg-open", [authorize.toString()], { stdio: "ignore", detached: true }).on("error", () => {});
  });
});

const tok = await fetch(`${AUTH}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: FO_URL }),
});
if (!tok.ok) throw new Error(`Getting Fo's token failed: ${tok.status} ${await tok.text()}`);
const t = await tok.json();

const { error } = await createClient(url, key, { auth: { persistSession: false } }).rpc("srv_fo_save_auth", {
  p_client_id: clientId, p_access: t.access_token, p_refresh: t.refresh_token ?? null,
  p_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
});
if (error) throw new Error(`Saving Fo's token failed: ${error.message}`);
console.log("Fo Concierge is connected.");
