import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { runFoTurn, stopFoTurn } from "@/lib/fo-turn";

// Fo can take a while; each wait for its reply is capped well under this.
export const maxDuration = 60;

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
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";

  if (body?.stop === true) {
    await stopFoTurn(user.id, chat);
    return NextResponse.json({ status: "idle" });
  }

  const result = await runFoTurn(user.id, chat, text, chat ? "chat" : "general");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  return NextResponse.json({ status: result.status });
}
