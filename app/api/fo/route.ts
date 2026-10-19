import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { askFo, foReply, FoNotConnected, takeDrafts, withContext, type FoPage, type FoTurn } from "@/lib/fo";

// Fo can take a while; each wait for its reply is capped well under this.
export const maxDuration = 60;
const WAIT_SECONDS = 25;
// Fo has no way to cancel a request, so "stop" frees the chat on our side and
// the next message goes to Fo flagged as an update to the one that was stopped.
export const STOPPED = "Stopped. Add whatever you'd like and send it when you're ready.";

// Ask Fo Concierge for help ({ chat, text }), or, with no text, wait for Fo's
// answer to the request already in flight. With no chat, it's your thread
// from the Trips or Places page ({ page }). Fo's progress and replies are
// saved to your private thread; the browser reads it with fo_thread.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const chat: string | null = typeof body?.chat === "string" && body.chat ? body.chat : null;
  const page: FoPage = chat ? "chat" : "general";
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";

  const admin = supabaseAdmin();

  if (body?.stop === true) {
    const { data: state } = await admin.rpc("srv_fo_state", { p_user: user.id, p_chat: chat });
    if (state?.status === "working") {
      await admin.rpc("srv_fo_update", { p_user: user.id, p_chat: chat, p_conversation: "", p_status: "failed", p_text: STOPPED });
    }
    return NextResponse.json({ status: "idle" });
  }

  const save = (turn: FoTurn) => {
    // Messages Fo drafted for friends become Send cards; the database keeps only drafts to real friends.
    const { text: reply, drafts } = turn.status === "complete" ? takeDrafts(turn.response ?? "") : { text: turn.response ?? "", drafts: [] };
    return admin.rpc("srv_fo_update", {
      p_user: user.id, p_chat: chat, p_conversation: turn.conversationId ?? "",
      p_status: turn.status, p_text: (turn.status === "working" ? turn.progress : reply) ?? "", p_actions: drafts,
    });
  };

  let conversation: string | null;
  let turn: FoTurn;
  try {
    if (text) {
      const { data: start, error } = await admin.rpc("srv_fo_begin", { p_user: user.id, p_chat: chat, p_text: text });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (start.status === "busy") return NextResponse.json({ error: "Fo is still working on your last request." }, { status: 409 });
      if (start.status === "limit") return NextResponse.json({ error: "That's all the requests Fo can take from you today. Try again tomorrow." }, { status: 429 });
      if (start.status !== "ok") return NextResponse.json({ error: "You're not in this chat." }, { status: 403 });
      conversation = start.conversation_id;
      const stopped = await wasStopped(admin, user.id, chat);
      turn = await askFo(withContext(stopped ? `I stopped my previous request to add more. Treat this as an update to it, not a new request, and carry on from where you were: ${text}` : text, start, page), conversation);
    } else {
      const { data: state, error } = await admin.rpc("srv_fo_state", { p_user: user.id, p_chat: chat });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (state.status !== "working") return NextResponse.json({ status: "idle" });
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
    return NextResponse.json({ status: "failed" });
  }

  // They may have hit stop while Fo was answering; don't bring the request back to life.
  const { data: after } = await admin.rpc("srv_fo_state", { p_user: user.id, p_chat: chat });
  if (after?.status !== "working") return NextResponse.json({ status: "idle" });

  if (!turn.conversationId) turn = { ...turn, conversationId: conversation ?? "" };
  if (turn.status === "failed" && !turn.response) turn = { ...turn, response: "Fo couldn't finish that one. Please try again." };
  await save(turn);
  return NextResponse.json({ status: turn.status });
}

/** True when the last thing in the thread is the "Stopped" note, i.e. this message follows an interrupted request. */
async function wasStopped(admin: ReturnType<typeof supabaseAdmin>, user: string, chat: string | null) {
  // srv_fo_begin has just added this message, so the stop note is the one before it.
  let q = admin.from("fo_messages").select("role, body").eq("user_id", user).order("id", { ascending: false }).limit(2);
  q = chat ? q.eq("chat_id", chat) : q.is("chat_id", null);
  const { data } = await q;
  return data?.[1]?.role === "fo" && data[1].body === STOPPED;
}
