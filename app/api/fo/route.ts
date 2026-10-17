import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { askFo, foReply, FoNotConnected, withContext, type FoPage, type FoTurn } from "@/lib/fo";

// Fo can take a while; each wait for its reply is capped well under this.
export const maxDuration = 60;
const WAIT_SECONDS = 25;

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
  const page: FoPage = chat ? "chat" : body?.page === "trips" ? "trips" : "places";
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";

  const admin = supabaseAdmin();
  const save = (turn: FoTurn) => admin.rpc("srv_fo_update", {
    p_user: user.id, p_chat: chat, p_conversation: turn.conversationId ?? "",
    p_status: turn.status, p_text: (turn.status === "working" ? turn.progress : turn.response) ?? "",
  });

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
      turn = await askFo(withContext(text, start, page), conversation);
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

  if (!turn.conversationId) turn = { ...turn, conversationId: conversation ?? "" };
  if (turn.status === "failed" && !turn.response) turn = { ...turn, response: "Fo couldn't finish that one. Please try again." };
  await save(turn);
  return NextResponse.json({ status: turn.status });
}
