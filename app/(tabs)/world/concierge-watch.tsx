"use client";

import { useEffect, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CONCIERGE_SEEN } from "@/components/tab-bar";

/** Opening the World tab counts as having seen today's Concierge watch. */
export function MarkWatchSeen({ hasNew }: { hasNew: boolean }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  useEffect(() => {
    if (!hasNew) return;
    supabase.rpc("concierge_mark_seen").then(({ error }) => {
      if (!error) window.dispatchEvent(new Event(CONCIERGE_SEEN));
    });
  }, [supabase, hasNew]);
  return null;
}
