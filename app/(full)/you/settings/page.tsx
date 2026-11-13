import { requireProfile } from "@/lib/session";
import { BackBar } from "@/components/ui";
import { SettingsClient, type FoSharing, type PushPrefs } from "./settings-client";

export default async function SettingsPage() {
  const { supabase, user, profile } = await requireProfile();
  const [{ data: foSharing }, { data: pushPrefs }] = await Promise.all([
    supabase.rpc("my_fo_sharing"),
    supabase.rpc("my_push_prefs"),
  ]);
  return (
    <>
      <BackBar href="/you" title="Settings" />
      <SettingsClient profileId={profile.id} units={profile.units}
        foSharing={(foSharing ?? { on: false, email: null, phone: null }) as FoSharing} signInEmail={user.email ?? ""}
        pushPrefs={(pushPrefs ?? { messages: true, friend_requests: true, badge: true }) as PushPrefs} />
    </>
  );
}
