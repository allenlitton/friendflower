-- ============================================================================
-- Delete a chat from your list (2026-10-20)
--   "Delete" is for you only: the chat leaves your list and its history is hidden
--   from you. The other person keeps their copy. If they write again, the chat
--   comes back showing only the new messages. Deleting a verification chat you're
--   still in also leaves it.
-- ============================================================================

alter table public.chat_members add column if not exists cleared_at timestamptz;

create or replace function private.member_cleared_at(p_chat uuid, p_user uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select coalesce(m.cleared_at, '-infinity'::timestamptz)
  from public.chat_members m where m.chat_id = p_chat and m.user_id = p_user;
$$;
grant execute on function private.member_cleared_at(uuid, uuid) to authenticated;

alter policy "members read messages" on public.messages
  using (created_at <= private.member_left_at(chat_id, (select auth.uid()))
         and created_at > private.member_cleared_at(chat_id, (select auth.uid())));

create or replace function public.delete_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = v_me) then
    return;
  end if;
  if (select kind from public.chats where id = p_chat) = 'pod' and private.is_active_member(p_chat, v_me) then
    perform public.leave_chat(p_chat);
  end if;
  update public.chat_members set cleared_at = now(), last_read_at = now()
  where chat_id = p_chat and user_id = v_me;
end $$;

revoke execute on function public.delete_chat(uuid) from public, anon;
grant execute on function public.delete_chat(uuid) to authenticated;

create or replace function public.my_chats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_result jsonb;
begin
  select coalesce(jsonb_agg(row_data order by last_at desc), '[]') into v_result
  from (
    select ch.last_message_at as last_at, jsonb_build_object(
      'id', ch.id, 'kind', ch.kind, 'last_message_at', ch.last_message_at,
      'left', me.left_at is not null,
      'members', (select jsonb_agg(private.mini(m.user_id) || jsonb_build_object('left', m.left_at is not null))
                  from public.chat_members m where m.chat_id = ch.id and m.user_id <> v_me),
      'last', (select jsonb_build_object('body', msg.body, 'kind', msg.kind,
                        'sender', case when msg.sender_id = v_me then 'me'
                                       else private.display_name(msg.sender_id) end)
               from public.messages msg
               where msg.chat_id = ch.id and msg.created_at <= coalesce(me.left_at, 'infinity')
                 and msg.created_at > coalesce(me.cleared_at, '-infinity')
               order by msg.created_at desc limit 1),
      'unread', exists (select 1 from public.messages msg
                        where msg.chat_id = ch.id and msg.created_at > me.last_read_at
                          and msg.created_at <= coalesce(me.left_at, 'infinity')
                          and msg.created_at > coalesce(me.cleared_at, '-infinity')
                          and msg.sender_id is distinct from v_me),
      'verification', (select jsonb_build_object('id', v.id, 'status', private.effective_status(v.status, v.expires_at))
                       from public.verifications v where v.chat_id = ch.id limit 1)
    ) as row_data
    from public.chats ch
    join public.chat_members me on me.chat_id = ch.id and me.user_id = v_me
    where not (ch.kind = 'direct' and exists (
      select 1 from public.chat_members o
      where o.chat_id = ch.id and o.user_id <> v_me and private.is_blocked(v_me, o.user_id)))
      and exists (select 1 from public.messages msg where msg.chat_id = ch.id)
      and (me.cleared_at is null or ch.last_message_at > me.cleared_at)
  ) x;
  return v_result;
end $$;
