import { requireProfile } from "@/lib/session";
import { getPlan } from "@/lib/plan";
import { FoChat, type FoThread } from "@/components/fo-concierge";
import { BackBar } from "@/components/ui";
import { BlossomNote } from "@/components/blossom";

export default async function FoPage({ searchParams }: PageProps<"/fo">) {
  const sp = await searchParams;
  const draft = typeof sp.draft === "string" ? sp.draft.slice(0, 1000) : "";
  const { supabase } = await requireProfile();
  const [{ data }, plan] = await Promise.all([supabase.rpc("fo_thread", { p_chat: null }), getPlan()]);
  const thread = (data ?? { status: "idle", progress: null, messages: [] }) as FoThread;
  // Free members who used Fo before keep their history; asking for more needs Blossom.
  if (!plan.isBlossom && thread.messages.length === 0) {
    return (
      <>
        <BackBar href="/chats" title="Fo Concierge" />
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          <BlossomNote title="Fo Concierge is part of Blossom">
            Fo Concierge finds the place, books the table, and sorts flights and deliveries for you.
          </BlossomNote>
        </div>
      </>
    );
  }
  return <FoChat initial={thread} initialDraft={draft} />;
}
