import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { apnsConfigured, sendPush, type PushToken } from "@/lib/apns";

type Waiting = { title: string; body: string; url: string; badge: number | null; tokens: PushToken[] };

// Called by the database (see private.push_kick) whenever notifications are queued. Takes
// everything waiting and hands it to Apple. Protected by a shared secret, not a member login.
export async function POST(request: Request) {
  const secret = process.env.PUSH_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  if (!apnsConfigured()) return NextResponse.json({ error: "APNs isn't set up" }, { status: 503 });

  const admin = supabaseAdmin();
  let sent = 0;
  for (;;) {
    const { data, error } = await admin.rpc("srv_push_claim", { p_limit: 100 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Waiting[];
    if (batch.length === 0) break;
    const jobs = batch.flatMap((n) => n.tokens.map((t) => sendPush(t, n)));
    for (const o of await Promise.all(jobs)) {
      if (!o.dead && o.env) sent++;
      await admin.rpc("srv_push_token_result", { p_token: o.token, p_env: o.env, p_dead: o.dead });
    }
    if (batch.length < 100) break;
  }
  return NextResponse.json({ sent });
}
