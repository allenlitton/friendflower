import { requireProfile } from "@/lib/session";
import { TabBar } from "@/components/tab-bar";
import { HomeScreenPrompt } from "@/components/home-screen-prompt";
import { RememberEmail } from "@/components/remember-email";

export default async function TabsLayout({ children }: LayoutProps<"/">) {
  const { user, profile } = await requireProfile();
  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <TabBar myName={profile.first_name} liveLocation={profile.share_live_location && profile.show_distance} />
      <HomeScreenPrompt />
      {user.email && <RememberEmail email={user.email} />}
    </>
  );
}
