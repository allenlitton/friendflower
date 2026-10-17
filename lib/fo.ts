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
    if (result.isError) return { status: "failed", conversationId: "", response: words ?? "Fo couldn't do that." };
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
export type FoPage = "chat" | "trips" | "places";
const ABOUT: Record<FoPage, string> = {
  chat: "help with a meetup (finding a place, booking a table, timing)",
  trips: "help with their trips, flights or getting a small package delivered",
  places: "help finding a place to meet or booking a table",
};

export function withContext(text: string, who: { me: string; home_city: string | null; others: string[] }, page: FoPage) {
  const meeting = who.others.length ? ` They are planning to meet ${who.others.join(" and ")}.` : "";
  return [
    `[Friend Flower · Fo Concierge] A request from ${who.me}${who.home_city ? `, who lives in ${who.home_city}` : ""}.${meeting}`,
    `They are a member of the Friend Flower app asking for ${ABOUT[page]}, not the owner of this Wajo account.`,
    "Check with them before spending money, and don't share the account owner's personal details.",
    "",
    text,
  ].join("\n");
}
