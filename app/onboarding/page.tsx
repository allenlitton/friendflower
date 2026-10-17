import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { loadEditorData } from "@/lib/editor-data";
import { ProfileEditor } from "@/components/profile-editor";

export default async function OnboardingPage() {
  const { supabase, user, profile } = await getSession();
  if (!user || !profile) redirect("/signin");
  if (profile.onboarded_at) redirect("/nearby");
  const data = await loadEditorData(supabase, user.id);

  return (
    <main className="flex-1 overflow-y-auto px-6 pt-1.5 pb-6">
      <h1 className="font-display text-[36px] leading-[1.1]">Create your profile</h1>
      <p className="mt-2 mb-[18px] text-[16.2px] leading-normal text-muted">
        Set how friends and friends of friends might find you.
      </p>
      <ProfileEditor mode="onboarding" profile={profile} {...data} />
    </main>
  );
}
