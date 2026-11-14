-- ============================================================================
-- Read receipts (2026-10-21)
--   Chats show "Seen" under your latest message someone has read.
--   profiles.show_read_receipts (on by default) works both ways: turn it off and
--   nobody sees when you've read their messages, and you don't see theirs.
--   chat_members stays unreadable; chat_reads() is the only way in, and it
--   checks both people's setting.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

alter table public.profiles add column show_read_receipts boolean not null default true;

-- For each other member of a chat you're in: the newest message they've read.
-- Message ids only ever go up, so the client compares ids, not clocks.
create or replace function public.chat_reads(p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'last_read_id', r.id)), '[]')
  from public.chat_members m
  join public.profiles pr on pr.id = m.user_id and pr.show_read_receipts
  cross join lateral (
    select max(msg.id) as id from public.messages msg
    where msg.chat_id = p_chat and msg.created_at <= m.last_read_at
  ) r
  where m.chat_id = p_chat and m.user_id <> private.me() and m.left_at is null
    and r.id is not null
    and private.is_active_member(p_chat, private.me())
    and (select show_read_receipts from public.profiles where id = private.me())
    and not exists (select 1 from public.chats ch where ch.id = p_chat and ch.kind = 'direct'
                    and private.is_blocked(private.me(), m.user_id));
$$;

revoke execute on function public.chat_reads(uuid) from public, anon;
grant execute on function public.chat_reads(uuid) to authenticated;
