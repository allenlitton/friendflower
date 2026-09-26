import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashContacts } from "@/lib/hash";

// Receives phone numbers/emails from the user's contacts, hashes them right
// here, and stores only the hashes. The raw list is never saved or logged.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const contacts: unknown = body?.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return NextResponse.json({ error: "No contacts received" }, { status: 400 });
  }
  if (contacts.length > 10000) {
    return NextResponse.json({ error: "That's a lot of contacts — try 10,000 or fewer at a time" }, { status: 400 });
  }

  const hashes = hashContacts(contacts as string[]);
  const { data, error } = await supabaseAdmin().rpc("srv_add_contact_hashes", {
    p_user: user.id,
    p_hashes: hashes,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checked: hashes.length, ...data });
}
