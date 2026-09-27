import { requireProfile } from "@/lib/session";
import { BackBar } from "@/components/ui";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const { profile } = await requireProfile();
  return (
    <>
      <BackBar href="/you" title="Settings" />
      <SettingsClient profileId={profile.id} units={profile.units} />
    </>
  );
}
