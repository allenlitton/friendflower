import { requireProfile } from "@/lib/session";
import { TabBar } from "@/components/tab-bar";
import { RememberEmail } from "@/components/remember-email";

export default async function TabsLayout({ children }: LayoutProps<"/">) {
  const { user, profile } = await requireProfile();
  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <TabBar myName={profile.first_name} myId={profile.id} avatarUrl={profile.avatar_url} liveLocation={profile.share_live_location && profile.show_distance} />
      {user.email && <RememberEmail email={user.email} />}
    </>
  );
}
