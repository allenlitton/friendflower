import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** The signed-in user and their own profile row (deduplicated per request). */
export const getSession = cache(async () => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
  return { supabase, user, profile };
});

/** For app screens: must be signed in and have finished creating a profile. */
export async function requireProfile() {
  const s = await getSession();
  if (!s.user) redirect("/signin");
  if (!s.profile?.onboarded_at) redirect("/onboarding");
  return { ...s, user: s.user, profile: s.profile };
}
