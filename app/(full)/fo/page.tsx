import { requireProfile } from "@/lib/session";
import { FoChat, type FoThread } from "@/components/fo-concierge";

export default async function FoPage({ searchParams }: PageProps<"/fo">) {
  const sp = await searchParams;
  const draft = typeof sp.draft === "string" ? sp.draft.slice(0, 1000) : "";
  const { supabase } = await requireProfile();
  const { data } = await supabase.rpc("fo_thread", { p_chat: null });
  return <FoChat initial={(data ?? { status: "idle", progress: null, messages: [] }) as FoThread} initialDraft={draft} />;
}
