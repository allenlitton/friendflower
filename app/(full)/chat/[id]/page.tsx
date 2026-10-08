import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/session";
import type { ChatDetail, MeetOptions, MeetState, Message } from "@/lib/types";
import { ChatView } from "./chat-view";

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireProfile();
  const { data } = await supabase.rpc("chat_detail", { p_chat: id });
  const chat = data as ChatDetail | null;
  if (!chat) notFound();

  const home = profile.home_city_id ?? "";
  const [{ data: messages }, { data: curated }, { data: circlePlaces }, { data: homeCity }] = await Promise.all([
    supabase.from("messages").select("*").eq("chat_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("venues").select("id, name, kind, city_id, cities(short_name)").order("sort"),
    supabase.rpc("venues_in", { p_city: home }),
    supabase.from("cities").select("short_name").eq("id", home).maybeSingle(),
  ]);
  // Curated places everywhere, plus places your circle has added in your city.
  type Row = { id: string; name: string; kind: string; city_id: string; cities: { short_name: string } };
  const venues = [...((curated ?? []) as unknown as Row[])];
  for (const v of (circlePlaces ?? []) as { id: string; name: string; kind: string }[]) {
    if (!venues.some((x) => x.id === v.id)) venues.push({ ...v, city_id: home, cities: { short_name: homeCity?.short_name ?? "" } });
  }
  await supabase.rpc("mark_read", { p_chat: id });

  // Shared days and suggested times only exist in 1:1 chats.
  const [{ data: meet }, { data: times }] = chat.kind === "direct"
    ? await Promise.all([supabase.rpc("meet_options", { p_chat: id }), supabase.rpc("meet_state", { p_chat: id })])
    : [{ data: null }, { data: [] }];

  return (
    <ChatView
      chat={chat}
      meId={profile.id}
      homeCity={profile.home_city_id}
      initial={((messages ?? []) as Message[]).reverse()}
      venues={venues}
      meet={(meet ?? null) as MeetOptions | null}
      initialTimes={(times ?? []) as MeetState[]}
    />
  );
}
