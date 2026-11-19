import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Avatar, Flower } from "@/components/ui";
import { AcceptInvite } from "./accept-invite";

export default async function InvitePage({ params }: PageProps<"/invite/[code]">) {
  const { code } = await params;
  const supabase = await supabaseServer();
  const [{ data: inviter }, { data: { user } }] = await Promise.all([
    supabase.rpc("invite_preview", { p_code: code }),
    supabase.auth.getUser(),
  ]);

  // Already signed in (e.g. the link opened the app): add them straight away, no button.
  // Someone still mid-sign-up finishes onboarding first; the invite they carried
  // through sign-in (ff_invite) is redeemed when their profile is saved.
  if (inviter && user) {
    const { data: me } = await supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle();
    if (!me?.onboarded_at) redirect("/");
    const { data: inviterId } = await supabase.rpc("redeem_invite", { p_code: code });
    redirect(inviterId ? `/people/${inviterId}` : "/");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-7 text-center">
      {inviter ? (
        <Avatar id={code} name={inviter.first_name} src={inviter.avatar_url} size={96} />
      ) : (
        <Flower size={83} stroke="#fff" strokeWidth={2.1} />
      )}
      <h1 className="font-display text-[34px] leading-[1.1]">
        {inviter ? `${inviter.first_name} invited you to friend flower` : "friend flower"}
      </h1>
      <p className="max-w-[300px] text-[16.8px] leading-normal text-muted">
        Mutual connections are magical. Keep track of where in the world your friends are, and meet friends of friends wherever you are.
      </p>
      <AcceptInvite code={code} valid={!!inviter} />
    </main>
  );
}
