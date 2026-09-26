import { requireProfile } from "@/lib/session";
import { loadEditorData } from "@/lib/editor-data";
import { ProfileEditor } from "@/components/profile-editor";
import { BackBar } from "@/components/ui";

export default async function EditProfilePage() {
  const { supabase, user, profile } = await requireProfile();
  const data = await loadEditorData(supabase, user.id);
  return (
    <>
      <BackBar href="/you" title="Edit profile" />
      <div className="flex-1 overflow-y-auto px-[22px] pt-[18px] pb-6">
        <ProfileEditor mode="edit" profile={profile} {...data} />
      </div>
    </>
  );
}
