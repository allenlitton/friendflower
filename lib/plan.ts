import "server-only";
import { cache } from "react";
import { getSession } from "@/lib/session";
import type { Plan } from "@/lib/blossom";

/** The signed-in member's plan (deduplicated per request). */
export const getPlan = cache(async () => {
  const { supabase } = await getSession();
  const { data } = await supabase.rpc("my_plan");
  const plan = (data ?? { plan: "free", until: null, source: null, friends: 0 }) as Plan;
  return { ...plan, isBlossom: plan.plan === "blossom" };
});
