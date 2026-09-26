import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/session";
import type { ChatDetail, Message } from "@/lib/types";
import { ChatView } from "./chat-view";

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireProfile();
  const { data } = await supabase.rpc("chat_detail", { p_chat: id });
  const chat = data as ChatDetail | null;
  if (!chat) notFound();

  const [{ data: messages }, { data: venues }] = await Promise.all([
    supabase.from("messages").select("*").eq("chat_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("venues").select("id, name, kind, city_id, cities(short_name)").order("sort"),
  ]);
  await supabase.rpc("mark_read", { p_chat: id });

  return (
    <ChatView
      chat={chat}
      meId={profile.id}
      homeCity={profile.home_city_id}
      initial={((messages ?? []) as Message[]).reverse()}
      venues={(venues ?? []) as unknown as { id: string; name: string; kind: string; city_id: string; cities: { short_name: string } }[]}
    />
  );
}
