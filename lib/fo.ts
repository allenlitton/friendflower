import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Talks to Fo (wajo.ai) over its MCP endpoint, as the one shared Wajo account
 * Friend Flower connected with `npm run fo:connect`. Tokens live in the
 * database (private.fo_auth) and are refreshed here when they expire.
 */
export const FO_URL = "https://mcp.api.wajo.ai/fo";
const TOKEN_URL = "https://mcp.api.wajo.ai/oauth/token";

export type FoTurn = { status: "complete" | "working" | "failed"; conversationId: string; response?: string; progress?: string };

export class FoNotConnected extends Error {
  constructor() { super("Fo Concierge isn't connected yet."); }
}

type Auth = { client_id: string; access_token: string; refresh_token: string | null; expires_at: string };

async function loadAuth(): Promise<Auth> {
  const { data, error } = await supabaseAdmin().rpc("srv_fo_auth");
  if (error) throw new Error(error.message);
  if (!data) throw new FoNotConnected();
  return data as Auth;
}

async function refresh(stale: Auth): Promise<Auth> {
  if (!stale.refresh_token) throw new FoNotConnected();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: stale.refresh_token, client_id: stale.client_id, resource: FO_URL }),
  });
  if (!res.ok) {
    // Another request may have just refreshed (refresh tokens are single-use).
    const now = await loadAuth();
    if (now.access_token !== stale.access_token) return now;
    throw new FoNotConnected();
  }
  const t = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
  const fresh: Auth = {
    client_id: stale.client_id, access_token: t.access_token, refresh_token: t.refresh_token ?? stale.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
  const { error } = await supabaseAdmin().rpc("srv_fo_save_auth", {
    p_client_id: fresh.client_id, p_access: fresh.access_token, p_refresh: fresh.refresh_token, p_expires_at: fresh.expires_at,
  });
  if (error) throw new Error(error.message);
  return fresh;
}

async function accessToken(force = false) {
  const auth = await loadAuth();
  if (!force && new Date(auth.expires_at).getTime() > Date.now() + 60_000) return auth;
  return refresh(auth);
}

let rpcId = 0;

/** Calls one of Fo's MCP tools and returns its structured result. */
async function callTool(name: string, args: Record<string, unknown>): Promise<FoTurn> {
  let auth = await accessToken();
  for (let attempt = 0; ; attempt++) {
    const id = ++rpcId;
    const res = await fetch(FO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${auth.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    });
    if (res.status === 401 && attempt === 0) { auth = await accessToken(true); continue; }
    if (res.status === 401) throw new FoNotConnected();
    if (!res.ok) throw new Error(`Fo answered ${res.status}`);

    const text = await res.text();
    // Either plain JSON or a server-sent event stream of JSON-RPC messages.
    const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(text)];
    const msg = messages.find((m) => m.id === id);
    if (!msg) throw new Error("Fo sent no answer");
    if (msg.error) throw new Error(msg.error.message ?? "Fo failed");
    const result = msg.result as { structuredContent?: FoTurn; content?: { type: string; text?: string }[]; isError?: boolean };
    const words = result.content?.find((c) => c.type === "text")?.text;
    if (result.isError) return { status: "failed", conversationId: "", response: words ?? "Fo Concierge couldn't do that." };
    if (result.structuredContent) return result.structuredContent;
    try { return JSON.parse(words ?? "") as FoTurn; } catch { return { status: "complete", conversationId: "", response: words }; }
  }
}

export function askFo(message: string, conversationId: string | null) {
  return callTool("ask_fo", conversationId ? { message, conversationId } : { message, newConversation: true });
}

export function foReply(conversationId: string | null, waitSeconds: number) {
  return callTool("get_fo_reply", conversationId ? { conversationId, waitSeconds } : { waitSeconds });
}

/**
 * Fo runs from a shared account and hears from many members, so every request
 * says who it's from and what it's for.
 */
export type FoPage = "chat" | "trips" | "places" | "general";
const ABOUT: Record<FoPage, string> = {
  chat: "help with a meetup (finding a place, booking a table, timing)",
  trips: "help with their trips, flights or getting a small package delivered",
  general: "help with meetups, trips, flights, deliveries, finding a place or booking a table",
  places: "help finding a place to meet or booking a table",
};

type FoLocation = { lat: number; lng: number; neighbourhood: string | null; city: string | null };

/** A friend as Fo sees them. Where they are and how to reach them only come for friends who opted in. */
type FoFriend = {
  ref: string; name: string; shares: boolean;
  now?: { city: string; presence: "lives" | "visiting"; until: string | null; neighbourhood: string | null } | null;
  upcoming?: { city: string; from: string; to: string }[];
  email?: string | null; phone?: string | null;
};

function friendLine(f: FoFriend) {
  const bits = [`- ${f.name} (ref ${f.ref})`];
  if (!f.shares) return `${bits[0]}: hasn't shared where they are or contact details. Only a Friend Flower message is possible.`;
  if (f.now) {
    const at = `${f.now.neighbourhood ? `${f.now.neighbourhood}, ` : ""}${f.now.city}`;
    bits.push(f.now.presence === "visiting" ? `visiting ${at}${f.now.until ? ` until ${f.now.until}` : ""}` : `lives in ${at}`);
  }
  if (f.upcoming?.length) bits.push(`upcoming: ${f.upcoming.map((u) => `${u.city} ${u.from} to ${u.to}`).join("; ")}`);
  if (f.email) bits.push(`email ${f.email}`);
  if (f.phone) bits.push(`phone ${f.phone}`);
  return bits.join(" · ");
}

function friendsSection(friends: FoFriend[], me: string) {
  if (!friends.length) return [];
  return [
    "",
    `${me}'s friends on Friend Flower:`,
    ...friends.map(friendLine),
    "",
    "To send one of these friends a Friend Flower message, don't send it yourself. Write the draft in your reply exactly like this, using their ref:",
    "<<ff-message to=REF>>",
    "the message, written as the member",
    "<</ff-message>>",
    "The app shows the member a button to send it as themselves. Never say it has been sent.",
    "Only email or text friends listed with an email or phone (they chose to share them for this). Show the member the exact message and wait for their OK first, and say it's from them via Friend Flower.",
  ];
}

/**
 * Pulls the drafted Friend Flower messages out of Fo's reply. Returns the
 * reply without them, and the drafts as { ref, body }.
 */
export function takeDrafts(reply: string) {
  const drafts: { ref: string; body: string }[] = [];
  const text = reply.replace(/<<ff-message to=\s*"?([0-9a-f]{8})"?\s*>>([\s\S]*?)<<\/ff-message>>/gi, (_, ref: string, body: string) => {
    if (body.trim()) drafts.push({ ref: ref.toLowerCase(), body: body.trim().slice(0, 2000) });
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { text: text || (drafts.length ? "Here's a message, ready to send." : ""), drafts };
}

export function withContext(text: string, who: { me: string; home_city: string | null; others: string[]; location?: FoLocation | null; friends?: FoFriend[] }, page: FoPage) {
  const meeting = who.others.length ? ` They are planning to meet ${who.others.join(" and ")}.` : "";
  // Only there when they have Live distance on and the app sent a position in the last 30 minutes.
  const loc = who.location;
  const area = loc && [loc.neighbourhood && `near ${loc.neighbourhood}`, loc.city && `in ${loc.city}`].filter(Boolean).join(" ");
  return [
    `[Friend Flower · Fo Concierge] A request from ${who.me}${who.home_city ? `, who lives in ${who.home_city}` : ""}.${meeting}`,
    ...(loc ? [`Where they are right now (live from the app, to about 100 m): ${area ? `${area}, ` : ""}${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}. Use this instead of asking where they are.`] : []),
    `They are a member of the Friend Flower app asking for ${ABOUT[page]}, not the owner of this Wajo account.`,
    "Check with them before spending money, and don't share the account owner's personal details.",
    ...friendsSection(who.friends ?? [], who.me),
    "",
    text,
  ].join("\n");
}
