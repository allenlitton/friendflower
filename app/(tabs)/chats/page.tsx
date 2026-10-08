import Link from "next/link";
import { requireProfile } from "@/lib/session";
import type { ChatSummary, Inbox } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { Avatar, ScreenTitle, SectionLabel } from "@/components/ui";
import { InboxActions } from "./inbox-actions";

export default async function ChatsPage() {
  const { supabase } = await requireProfile();
  const [{ data: chats }, { data: inbox }] = await Promise.all([supabase.rpc("my_chats"), supabase.rpc("inbox")]);
  const list = (chats ?? []) as ChatSummary[];
  const box = inbox as Inbox;

  return (
    <>
      <ScreenTitle>Chats</ScreenTitle>
      <div className="flex-1 overflow-y-auto px-[13px] pt-0.5 pb-3.5">
        {(box.friend_requests.length > 0 || box.verifications.length > 0) && (
          <div className="px-2 pt-2 pb-3">
            <SectionLabel>Waiting on you</SectionLabel>
            <InboxActions inbox={box} />
          </div>
        )}

        {list.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] leading-normal text-muted">
            No chats yet. Open someone&apos;s profile on <Link href="/nearby" className="text-pink">Nearby</Link> and say hello.
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {list.map((c) => {
            const others = c.members;
            const first = others[0];
            const title = c.kind === "pod" ? others.map((m) => m.first_name).join(" · ") : first?.name;
            const last = c.last ? (c.last.sender === "me" ? "You: " : c.last.sender && c.kind === "pod" ? `${c.last.sender.split(" ")[0]}: ` : "") + (c.last.kind === "venue" ? `📍 ${c.last.body}` : c.last.kind === "times" ? `🗓 ${c.last.body}` : c.last.body) : "";
            return (
              <Link key={c.id} href={`/chat/${c.id}`} className="flex items-center gap-3 rounded-[15px] px-2.5 py-[11px] hover:bg-raised">
                <div className="relative">
                  {first && <Avatar id={first.id} name={first.name} src={c.kind === "pod" ? null : first.avatar_url} size={48} />}
                  {c.kind === "pod" && (
                    <span className="absolute -right-0.5 -bottom-0.5 rounded-full border-[1.5px] border-[#f4e9f2] bg-white px-[5px] py-px text-[9px] font-bold text-pink">pod</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold">{title}</span>
                    <span className="flex-none text-[11px] text-faint">{timeAgo(c.last_message_at)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-muted">{last}</div>
                </div>
                {c.unread && <span className="h-[9px] w-[9px] flex-none rounded-full bg-pink" />}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
