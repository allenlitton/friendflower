import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { askFo, foReply, FoNotConnected, withContext, type FoPage, type FoTurn } from "@/lib/fo";

/**
 * One request to Fo Concierge for a member, from the site or the round device:
 * start it (with text) or wait for Fo's answer to the one in flight. Fo's
 * progress and replies are saved to the member's private thread (fo_threads /
 * fo_messages) for that chat, or their general thread when there's no chat.
 */

// Each wait for Fo's reply is capped well under the routes' maxDuration.
const WAIT_SECONDS = 25;
// Fo has no way to cancel a request, so "stop" frees the chat on our side and
// the next message goes to Fo flagged as an update to the one that was stopped.
export const STOPPED = "Stopped. Add whatever you'd like and send it when you're ready.";

export type FoTurnResult =
  | { ok: true; status: "idle" | FoTurn["status"] }
  | { ok: false; httpStatus: number; error: string };

type Admin = ReturnType<typeof supabaseAdmin>;

export async function stopFoTurn(user: string, chat: string | null) {
  const admin = supabaseAdmin();
  const { data: state } = await admin.rpc("srv_fo_state", { p_user: user, p_chat: chat });
  if (state?.status === "working") {
    await admin.rpc("srv_fo_update", { p_user: user, p_chat: chat, p_conversation: "", p_status: "failed", p_text: STOPPED });
  }
}

/** Starts a request with `text`, or with no text waits for the one already in flight. */
export async function runFoTurn(user: string, chat: string | null, text: string, page: FoPage): Promise<FoTurnResult> {
  const admin = supabaseAdmin();
  const save = (turn: FoTurn) => admin.rpc("srv_fo_update", {
    p_user: user, p_chat: chat, p_conversation: turn.conversationId ?? "",
    p_status: turn.status, p_text: (turn.status === "working" ? turn.progress : turn.response) ?? "",
  });

  let conversation: string | null;
  let turn: FoTurn;
  try {
    if (text) {
      const { data: start, error } = await admin.rpc("srv_fo_begin", { p_user: user, p_chat: chat, p_text: text });
      if (error) return { ok: false, httpStatus: 500, error: error.message };
      if (start.status === "busy") return { ok: false, httpStatus: 409, error: "Fo is still working on your last request." };
      if (start.status === "limit") return { ok: false, httpStatus: 429, error: "That's all the requests Fo can take from you today. Try again tomorrow." };
      if (start.status !== "ok") return { ok: false, httpStatus: 403, error: "You're not in this chat." };
      conversation = start.conversation_id;
      const stopped = await wasStopped(admin, user, chat);
      turn = await askFo(withContext(stopped ? `I stopped my previous request to add more. Treat this as an update to it, not a new request, and carry on from where you were: ${text}` : text, start, page), conversation);
    } else {
      const { data: state, error } = await admin.rpc("srv_fo_state", { p_user: user, p_chat: chat });
      if (error) return { ok: false, httpStatus: 500, error: error.message };
      if (state.status !== "working") return { ok: true, status: "idle" };
      conversation = state.conversation_id;
      turn = await foReply(conversation, WAIT_SECONDS);
    }
  } catch (e) {
    const message = e instanceof FoNotConnected
      ? "Fo Concierge isn't available right now."
      : "Fo couldn't be reached. Please try again.";
    if (!(e instanceof FoNotConnected)) console.error("Fo request failed", e);
    else console.error("Fo is not connected: run npm run fo:connect");
    await save({ status: "failed", conversationId: "", response: message });
    return { ok: true, status: "failed" };
  }

  // They may have hit stop while Fo was answering; don't bring the request back to life.
  const { data: after } = await admin.rpc("srv_fo_state", { p_user: user, p_chat: chat });
  if (after?.status !== "working") return { ok: true, status: "idle" };

  if (!turn.conversationId) turn = { ...turn, conversationId: conversation ?? "" };
  if (turn.status === "failed" && !turn.response) turn = { ...turn, response: "Fo couldn't finish that one. Please try again." };
  await save(turn);
  return { ok: true, status: turn.status };
}

/** True when the last thing in the thread is the "Stopped" note, i.e. this message follows an interrupted request. */
async function wasStopped(admin: Admin, user: string, chat: string | null) {
  // srv_fo_begin has just added this message, so the stop note is the one before it.
  let q = admin.from("fo_messages").select("role, body").eq("user_id", user).order("id", { ascending: false }).limit(2);
  q = chat ? q.eq("chat_id", chat) : q.is("chat_id", null);
  const { data } = await q;
  return data?.[1]?.role === "fo" && data[1].body === STOPPED;
}
