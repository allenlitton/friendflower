import { requireProfile } from "@/lib/session";
import { BackBar } from "@/components/ui";
import { DeviceClient, type Device } from "./device-client";

// Link the round Friend Flower device by typing the code it shows.
export default async function DevicePage({ searchParams }: PageProps<"/device">) {
  const { supabase } = await requireProfile();
  const sp = await searchParams;
  const { data } = await supabase.rpc("my_devices");
  return (
    <>
      <BackBar href="/you/settings" title="Your device" />
      <DeviceClient devices={(data ?? []) as Device[]} initialCode={typeof sp.code === "string" ? sp.code : ""} />
    </>
  );
}
