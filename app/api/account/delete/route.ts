import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Permanently deletes the signed-in user's account (required by the App Store).
// Almost everything hangs off profiles/auth.users with ON DELETE CASCADE (profile, trips,
// contact and identity hashes, location, friends, blocks, devices, Fo threads). Messages
// only set sender to null, so we delete those first, and the profile photos live in storage.
export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  const admin = supabaseAdmin();

  const { error: msgError } = await admin.from("messages").delete().eq("sender_id", user.id);
  if (msgError) return NextResponse.json({ error: "Couldn't delete your messages. Nothing was deleted." }, { status: 500 });

  const { data: files } = await admin.storage.from("avatars").list(user.id, { limit: 1000 });
  if (files?.length) await admin.storage.from("avatars").remove(files.map((f) => `${user.id}/${f.name}`));

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: "Couldn't delete your account. Please email hello@friendflower.app." }, { status: 500 });

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
