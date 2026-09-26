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
      <p className="max-w-[300px] text-[14px] leading-normal text-muted">
        Keep track of where in the world your friends are, and meet friends of friends wherever you are.
      </p>
      <AcceptInvite code={code} valid={!!inviter} signedIn={!!user} />
    </main>
  );
}
