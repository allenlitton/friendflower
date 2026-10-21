import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerHash } from "@/lib/device";
import { type FoPage } from "@/lib/fo";
import { runFoTurn, type FoTurnResult } from "@/lib/fo-turn";

export const maxDuration = 60;

// Talking to Fo from the round device. The device records a short clip (WAV,
// 16 kHz mono) and posts it here with the page it was on (?page=places) or a
// chat (?chat=<id>). We turn the speech into text, start a Fo request in the
// same thread the site uses, and answer with what we heard. The device then
// calls GET with the same query until Fo is done.
//
// With ?chat=<id>&mode=message, Fo writes the message you described instead
// of acting, and the device shows it with Send / Cancel. Nothing is posted in
// the chat until you tap Send (POST /api/device/chat/<id>/send).

const PAGES: Record<string, FoPage> = { trips: "trips", places: "places" };
const MAX_AUDIO = 1_000_000; // ~30 s at 16 kHz; the device stops at 15 s

async function context(request: Request) {
  const hash = bearerHash(request);
  if (!hash) return null;
  const { data: user } = await supabaseAdmin().rpc("srv_device_user", { p_token_hash: hash });
  if (!user) return null;
  const url = new URL(request.url);
  const chat = url.searchParams.get("chat");
  const page: FoPage = chat ? "chat" : PAGES[url.searchParams.get("page") ?? ""] ?? "general";
  return { user: user as string, chat: chat && /^[0-9a-f-]{36}$/.test(chat) ? chat : null, page, message: url.searchParams.get("mode") === "message" };
}

async function transcribe(audio: ArrayBuffer) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", new Blob([audio], { type: "audio/wav" }), "clip.wav");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { authorization: `Bearer ${key}` }, body: form,
  });
  if (!res.ok) throw new Error(`Transcription failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { text?: string }).text?.trim() ?? "";
}

/** What the device shows: Fo's progress while it works, else its latest reply. */
async function latest(user: string, chat: string | null, result: FoTurnResult) {
  if (!result.ok) return { status: "failed", text: result.error };
  const admin = supabaseAdmin();
  if (result.status === "working") {
    let q = admin.from("fo_threads").select("progress").eq("user_id", user);
    q = chat ? q.eq("chat_id", chat) : q.is("chat_id", null);
    const { data } = await q.maybeSingle();
    return { status: "working", text: data?.progress ?? "Fo Concierge is on it..." };
  }
  let q = admin.from("fo_messages").select("body").eq("user_id", user).eq("role", "fo").order("id", { ascending: false }).limit(1);
  q = chat ? q.eq("chat_id", chat) : q.is("chat_id", null);
  const { data } = await q.maybeSingle();
  return { status: result.status === "failed" ? "failed" : "complete", text: data?.body ?? "" };
}

export async function POST(request: Request) {
  const ctx = await context(request);
  if (!ctx) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const audio = await request.arrayBuffer();
  if (audio.byteLength < 1000) return NextResponse.json({ status: "failed", text: "I didn't catch that." });
  if (audio.byteLength > MAX_AUDIO) return NextResponse.json({ status: "failed", text: "That was too long. Try a shorter request." });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ status: "failed", text: "Voice isn't set up yet. Ask Fo Concierge at friendflower.app for now." });
  }
  let heard: string;
  try {
    heard = await transcribe(audio);
  } catch (e) {
    console.error("Device transcription failed", e);
    return NextResponse.json({ status: "failed", text: "Couldn't hear that right now. Please try again." });
  }
  if (!heard) return NextResponse.json({ status: "failed", text: "I didn't catch that." });

  const text = ctx.message
    ? `Write the chat message I want to send in this Friend Flower chat, from what I said: "${heard}". ` +
      "Reply with only the message text, written as me in my voice, with nothing before or after it. Don't send it anywhere yourself."
    : heard;
  const result = await runFoTurn(ctx.user, ctx.chat, text.slice(0, 2000), ctx.page);
  return NextResponse.json({ heard, ...(await latest(ctx.user, ctx.chat, result)) });
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const result = await runFoTurn(ctx.user, ctx.chat, "", ctx.page);
  // "idle" means nothing is in flight any more: show the last reply.
  return NextResponse.json(await latest(ctx.user, ctx.chat, result.ok && result.status === "idle" ? { ok: true, status: "complete" } : result));
}
