import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const { user, profile } = await getSession();
  if (!user) redirect("/signin");
  redirect(profile?.onboarded_at ? "/nearby" : "/onboarding");
}
