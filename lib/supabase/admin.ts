import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client with the SERVICE ROLE key. It bypasses all privacy rules,
 * so it must only ever run on the server, and only for the few srv_* functions
 * that handle hashed contact data.
 */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
