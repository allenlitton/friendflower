"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Interest } from "@/lib/types";
import { ErrorNote } from "@/components/ui";

const MAX = 20;
type Hit = Interest & { uses: number };

/** Interest/hobby tags on your profile. Typing searches tags people already use. */
export function InterestsEditor({ initial }: { initial: Interest[] }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [tags, setTags] = useState(initial);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Search as you type (debounced). An empty box shows popular tags.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_interests", { p_query: query });
      if (!cancelled) setHits((data as Hit[] | null) ?? []);
    }, query ? 150 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, supabase, tags.length]);

  const typed = query.trim().replace(/\s+/g, " ");
  const exact = hits.some((h) => h.name.toLowerCase() === typed.toLowerCase())
    || tags.some((t) => t.name.toLowerCase() === typed.toLowerCase());
  const full = tags.length >= MAX;

  async function add(name: string) {
    if (!name.trim() || busy || full) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("add_interest", { p_name: name });
    setBusy(false);
    if (error) return setError(error.message);
    const tag = data as Interest;
    setTags((ts) => (ts.some((t) => t.id === tag.id) ? ts : [...ts, tag]));
    setQuery("");
  }

  async function remove(id: string) {
    setTags((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase.rpc("remove_interest", { p_id: id });
    if (error) setError(error.message);
  }

  return (
    <div>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-[7px]">
          {tags.map((t) => (
            <button key={t.id} type="button" onClick={() => remove(t.id)} aria-label={`Remove ${t.name}`}
              className="flex items-center gap-1.5 rounded-full border-[1.5px] border-pink bg-pink px-[13px] py-[7px] text-[15px] font-semibold text-ink">
              {t.name}<span className="text-[13px] opacity-60">✕</span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <input className="field" placeholder={full ? `That's ${MAX}, the most you can add` : "Search interests, e.g. hiking, coffee"}
          value={query} maxLength={40} disabled={full}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const match = hits.find((h) => h.name.toLowerCase() === typed.toLowerCase());
            add(match?.name ?? (hits[0] && !typed ? hits[0].name : typed));
          }} />
        {open && !full && (hits.length > 0 || (typed && !exact)) && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[260px] overflow-y-auto rounded-[14px] border-[1.5px] border-line bg-card py-1 shadow-lg">
            {hits.map((h) => (
              <button key={h.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(h.name)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[15.6px] hover:bg-well">
                <span className="font-semibold">{h.name}</span>
                {h.uses > 0 && <span className="text-[13.2px] text-faint">{h.uses} {h.uses === 1 ? "person" : "people"}</span>}
              </button>
            ))}
            {typed && !exact && (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(typed)}
                className="flex w-full px-3.5 py-2.5 text-left text-[15.6px] font-semibold text-pink hover:bg-well">
                + Add “{typed}”
              </button>
            )}
          </div>
        )}
      </div>
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
      <div className="mt-1.5 text-[13.8px] leading-snug text-faint">
        Tap a tag to remove it. Friends see the interests you share, plus a few ways to start talking.
      </div>
    </div>
  );
}
