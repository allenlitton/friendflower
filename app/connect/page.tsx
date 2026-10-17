import { requireProfile } from "@/lib/session";
import type { Inbox } from "@/lib/types";
import { ConnectClient } from "./connect-client";
import { BackBar } from "@/components/ui";

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { supabase, profile } = await requireProfile();
  const welcome = (await searchParams).welcome === "1";
  const [{ data: stats }, { data: inbox }] = await Promise.all([
    supabase.rpc("my_contact_stats"),
    supabase.rpc("inbox"),
  ]);
  return (
    <main className="flex flex-1 flex-col">
      {!welcome && <BackBar href="/you" title="Find your friends" />}
      <div className="flex-1 overflow-y-auto px-6 pt-3 pb-8">
        {welcome && (
          <>
            <h1 className="font-display text-[36px] leading-[1.1]">Find your friends</h1>
            <p className="mt-2 text-[16.2px] leading-normal text-muted">
              Your circle is built from people who have each other in their contacts, plus friends you add or invite.
            </p>
          </>
        )}
        <ConnectClient
          welcome={welcome}
          inviteCode={profile.invite_code}
          myName={profile.first_name}
          stats={stats ?? { uploaded: 0, matches: 0, has_phone: false }}
          suggestions={(inbox as Inbox | null)?.contact_suggestions ?? []}
        />
      </div>
    </main>
  );
}
