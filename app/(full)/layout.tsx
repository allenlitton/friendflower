import { requireProfile } from "@/lib/session";
import { Presence } from "@/components/tab-bar";

// Full-screen pages (profile, chat, edit) — no tab bar.
export default async function FullLayout({ children }: LayoutProps<"/">) {
  await requireProfile();
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <Presence />
      {children}
    </main>
  );
}
