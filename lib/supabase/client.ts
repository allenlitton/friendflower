"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for use in the browser (client components). */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
