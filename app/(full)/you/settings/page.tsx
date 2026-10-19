import { requireProfile } from "@/lib/session";
import { BackBar } from "@/components/ui";
import { SettingsClient, type FoSharing } from "./settings-client";

export default async function SettingsPage() {
  const { supabase, user, profile } = await requireProfile();
  const { data: foSharing } = await supabase.rpc("my_fo_sharing");
  return (
    <>
      <BackBar href="/you" title="Settings" />
      <SettingsClient profileId={profile.id} units={profile.units}
        foSharing={(foSharing ?? { on: false, email: null, phone: null }) as FoSharing} signInEmail={user.email ?? ""} />
    </>
  );
}
