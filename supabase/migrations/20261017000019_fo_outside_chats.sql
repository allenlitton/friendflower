-- ============================================================================
-- Fo Concierge outside chats (2026-10-17)
--   "Ask Fo Concierge" is also on the Trips and Places pages. Requests made
--   there go to one more private thread per member, with no chat (chat_id
--   null), shared by both pages.
-- ============================================================================

alter table public.fo_threads drop constraint fo_threads_pkey;
alter table public.fo_threads alter column chat_id drop not null;
alter table public.fo_threads add constraint fo_threads_user_chat unique nulls not distinct (user_id, chat_id);
alter table public.fo_messages alter column chat_id drop not null;

create or replace function public.fo_thread(p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(t.status, 'idle'),
    'progress', t.progress,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.fo_messages m
      where m.user_id = private.me() and m.chat_id is not distinct from p_chat), '[]'::jsonb))
  from (select 1) one
  left join public.fo_threads t on t.user_id = private.me() and t.chat_id is not distinct from p_chat;
$$;

-- p_chat null = the member's thread outside chats (no membership to check,
-- nobody else to mention).
create or replace function public.srv_fo_begin(p_user uuid, p_chat uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_thread public.fo_threads;
begin
  if p_chat is not null and not exists (select 1 from public.chat_members cm
                 where cm.chat_id = p_chat and cm.user_id = p_user and cm.left_at is null) then
    return jsonb_build_object('status', 'not_member');
  end if;

  select * into v_thread from public.fo_threads where user_id = p_user and chat_id is not distinct from p_chat for update;
  -- A turn nobody came back for counts as finished after 15 minutes.
  if v_thread.status = 'working' and v_thread.updated_at > now() - interval '15 minutes' then
    return jsonb_build_object('status', 'busy');
  end if;

  if (select count(*) from public.fo_messages
      where user_id = p_user and role = 'me' and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('status', 'limit');
  end if;

  insert into public.fo_messages (user_id, chat_id, role, body) values (p_user, p_chat, 'me', left(p_text, 2000));
  insert into public.fo_threads (user_id, chat_id, status, progress)
  values (p_user, p_chat, 'working', null)
  on conflict (user_id, chat_id) do update set status = 'working', progress = null, updated_at = now();

  return jsonb_build_object(
    'status', 'ok',
    'conversation_id', v_thread.conversation_id,
    'me', private.display_name(p_user),
    'home_city', (select c.name from public.profiles pr join public.cities c on c.id = pr.home_city_id where pr.id = p_user),
    'others', coalesce((select jsonb_agg(private.display_name(cm.user_id) order by cm.joined_at)
                        from public.chat_members cm
                        where cm.chat_id = p_chat and cm.user_id <> p_user and cm.left_at is null), '[]'::jsonb));
end $$;

create or replace function public.srv_fo_state(p_user uuid, p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', coalesce(t.status, 'idle'), 'conversation_id', t.conversation_id)
  from (select 1) one
  left join public.fo_threads t on t.user_id = p_user and t.chat_id is not distinct from p_chat;
$$;

create or replace function public.srv_fo_update(p_user uuid, p_chat uuid, p_conversation text, p_status text, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('working', 'complete', 'failed') then raise exception 'Unknown status %', p_status; end if;
  update public.fo_threads
  set conversation_id = coalesce(nullif(p_conversation, ''), conversation_id),
      status = case when p_status = 'working' then 'working' else 'idle' end,
      progress = case when p_status = 'working' then left(p_text, 300) end,
      updated_at = now()
  where user_id = p_user and chat_id is not distinct from p_chat;
  if p_status <> 'working' and coalesce(p_text, '') <> '' then
    insert into public.fo_messages (user_id, chat_id, role, body) values (p_user, p_chat, 'fo', left(p_text, 8000));
  end if;
end $$;
