import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import type { Mini, VerificationStatus } from "@/lib/types";
import { Avatar, Flower, PetalHalo } from "@/components/ui";
import { ConfirmLink } from "./confirm-link";

type TokenView = {
  id: string; status: VerificationStatus; requester: Mini; target: Mini;
  mutual_name: string | null; can_confirm: boolean; confirmed_by: Mini | null;
};

// Where the mutual friend lands after tapping the verification link.
// They need to be signed in, but don't need a full profile yet.
export default async function VerifyLinkPage({ params }: PageProps<"/v/[token]">) {
  const { token } = await params;
  const { supabase, user, profile } = await getSession();
  if (!user) redirect(`/signin?next=/v/${token}`);
  const { data } = await supabase.rpc("verification_by_token", { p_token: token });
  const v = data as TokenView | null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-7 py-10 text-center">
      <Flower size={48} stroke="#fff" strokeWidth={2.4} />
      {!v ? (
        <p className="text-[14px] text-muted">This link isn&apos;t valid. Ask your friend to send a new one.</p>
      ) : (
        <>
          <div className="flex items-center">
            <PetalHalo size={84}><Avatar id={v.requester.id} name={v.requester.name} src={v.requester.avatar_url} size={54} /></PetalHalo>
            <PetalHalo size={84}><Avatar id={v.target.id} name={v.target.name} src={v.target.avatar_url} size={54} /></PetalHalo>
          </div>
          <h1 className="font-display text-[32px] leading-[1.1]">
            Do you know {v.requester.first_name} and {v.target.first_name}?
          </h1>
          <p className="max-w-[320px] text-[13.5px] leading-normal text-muted">
            {v.requester.name} asked you to confirm that you know both of them, so they can meet up knowing the connection is real.
            Only say yes if you know them both.
          </p>
          <ConfirmLink token={token} status={v.status} canConfirm={v.can_confirm}
            needsName={!profile?.first_name} confirmedBy={v.confirmed_by?.first_name ?? null} onboarded={!!profile?.onboarded_at} />
        </>
      )}
    </main>
  );
}
