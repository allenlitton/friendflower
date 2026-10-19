-- ============================================================================
-- Fo Concierge and your friends (2026-10-19)
--   1. One opt-in, off by default: "Share with my friends' Fo Concierge".
--      Only when a friend has turned it on does Fo see where they are (city,
--      plus neighbourhood if they show distance, plus upcoming trips you're
--      allowed to see) and the email / phone they chose to share. Never live
--      positions.
--   2. For everyone else Fo only gets the friend's name, so it can draft a
--      Friend Flower message for you.
--   3. Drafted messages show up in your Fo thread as cards and only go out,
--      as you, in your 1:1 chat when you tap Send.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The opt-in. A row here = sharing is on. Email and phone are optional.
-- ---------------------------------------------------------------------------
create table private.fo_sharing (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  email      text check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email) <= 200),
  phone      text check (phone ~ '^\+?[0-9][0-9 ().-]{5,24}$'),
  updated_at timestamptz not null default now()
);
alter table private.fo_sharing enable row level security;
revoke all on private.fo_sharing from public, anon, authenticated;

create or replace function public.my_fo_sharing()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('on', s.user_id is not null, 'email', s.email, 'phone', s.phone)
  from (select 1) one
  left join private.fo_sharing s on s.user_id = private.me();
$$;

create or replace function public.set_fo_sharing(p_on boolean, p_email text default null, p_phone text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := nullif(lower(trim(p_email)), ''); v_phone text := nullif(trim(p_phone), '');
begin
  if not p_on then
    delete from private.fo_sharing where user_id = private.me();
    return;
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email doesn''t look right';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9][0-9 ().-]{5,24}$' then
    raise exception 'That phone number doesn''t look right';
  end if;
  insert into private.fo_sharing (user_id, email, phone) values (private.me(), v_email, v_phone)
  on conflict (user_id) do update set email = excluded.email, phone = excluded.phone, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 2. Your friends, for Fo. Where they are and how to reach them only for
--    friends who opted in.
-- ---------------------------------------------------------------------------
create or replace function private.fo_friends(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with friends as (
    select case when r.from_id = p_user then r.to_id else r.from_id end as uid
    from public.friend_requests r
    where r.status = 'accepted' and (r.from_id = p_user or r.to_id = p_user)
  ),
  visible as (
    select f.uid, c.degree from friends f
    join private.circle(p_user) c on c.uid = f.uid
    where not private.is_blocked(p_user, f.uid)
  ),
  rows as (
    select private.display_name(v.uid) as name,
      jsonb_build_object('ref', right(v.uid::text, 8), 'name', private.display_name(v.uid), 'shares', s.user_id is not null)
      || case when s.user_id is null then '{}'::jsonb else jsonb_build_object(
        'now', (select jsonb_build_object(
                  'city', c.name, 'presence', w.presence, 'until', w.trip_end,
                  'neighbourhood', case when pr.show_distance then n.name end)
                from private.whereabouts(v.uid, v.degree, current_date) w
                join public.cities c on c.id = w.city_id
                left join public.neighbourhoods n on n.id = w.neighbourhood_id),
        'upcoming', coalesce((select jsonb_agg(jsonb_build_object('city', c.name, 'from', t.starts_on, 'to', t.ends_on) order by t.starts_on)
                              from public.trips t join public.cities c on c.id = t.city_id
                              where t.user_id = v.uid and t.starts_on > current_date and t.starts_on <= current_date + 120
                                and private.trip_visible(t.visibility, pr.show_trips, v.degree)), '[]'::jsonb),
        'email', s.email,
        'phone', s.phone) end as friend
    from visible v
    join public.profiles pr on pr.id = v.uid
    left join private.fo_sharing s on s.user_id = v.uid
    order by 1
    limit 100
  )
  select coalesce(jsonb_agg(r.friend order by r.name), '[]'::jsonb) from rows r;
$$;
revoke execute on function private.fo_friends(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Messages Fo drafts for you to send
-- ---------------------------------------------------------------------------
create table public.fo_actions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id bigint not null references public.fo_messages(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  status     text not null default 'pending' check (status in ('pending', 'sent', 'dismissed')),
  chat_id    uuid references public.chats(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.fo_actions (message_id);
alter table public.fo_actions enable row level security;
revoke all on public.fo_actions from anon, authenticated;

-- Server only: record what Fo said. 'working' updates the progress line;
-- 'complete' or 'failed' posts the reply, plus up to 5 drafted messages
-- ({ref, body}, kept only when ref is one of your friends), and frees the thread.
drop function public.srv_fo_update(uuid, uuid, text, text, text);
create or replace function public.srv_fo_update(p_user uuid, p_chat uuid, p_conversation text, p_status text, p_text text,
                                                p_actions jsonb default '[]')
returns void language plpgsql security definer set search_path = '' as $$
declare v_msg bigint; v_action jsonb; v_friend uuid;
begin
  if p_status not in ('working', 'complete', 'failed') then raise exception 'Unknown status %', p_status; end if;
  update public.fo_threads
  set conversation_id = coalesce(nullif(p_conversation, ''), conversation_id),
      status = case when p_status = 'working' then 'working' else 'idle' end,
      progress = case when p_status = 'working' then left(p_text, 300) end,
      updated_at = now()
  where user_id = p_user and chat_id is not distinct from p_chat;
  if p_status = 'working' or coalesce(p_text, '') = '' then return; end if;

  insert into public.fo_messages (user_id, chat_id, role, body) values (p_user, p_chat, 'fo', left(p_text, 8000))
  returning id into v_msg;
  for v_action in select e from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) e limit 5 loop
    -- Exactly one friend must match the ref, or the draft is dropped.
    select case when count(*) = 1 then min(f.uid::text)::uuid end into v_friend from (
      select case when r.from_id = p_user then r.to_id else r.from_id end as uid
      from public.friend_requests r
      where r.status = 'accepted' and (r.from_id = p_user or r.to_id = p_user)
    ) f
    where right(f.uid::text, 8) = v_action ->> 'ref' and not private.is_blocked(p_user, f.uid);
    if v_friend is not null and char_length(trim(v_action ->> 'body')) between 1 and 2000 then
      insert into public.fo_actions (user_id, message_id, friend_id, body)
      values (p_user, v_msg, v_friend, trim(v_action ->> 'body'));
    end if;
  end loop;
end $$;

-- Send a message Fo drafted, as you, in your 1:1 chat with that friend.
-- Returns the chat.
create or replace function public.fo_send_action(p_action bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_action public.fo_actions; v_chat uuid;
begin
  select * into v_action from public.fo_actions where id = p_action and user_id = v_me for update;
  if not found then raise exception 'Message not found'; end if;
  if v_action.status <> 'pending' then raise exception 'This message was already handled'; end if;
  if not private.is_friend(v_me, v_action.friend_id) or private.is_blocked(v_me, v_action.friend_id) then
    raise exception 'You can only message your friends';
  end if;
  v_chat := public.open_direct_chat(v_action.friend_id);
  perform public.send_message(v_chat, v_action.body, null);
  update public.fo_actions set status = 'sent', chat_id = v_chat where id = p_action;
  return v_chat;
end $$;

create or replace function public.fo_dismiss_action(p_action bigint)
returns void language sql security definer set search_path = '' as $$
  update public.fo_actions set status = 'dismissed'
  where id = p_action and user_id = private.me() and status = 'pending';
$$;

-- Your thread now includes the messages Fo drafted.
create or replace function public.fo_thread(p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(t.status, 'idle'),
    'progress', t.progress,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'created_at', m.created_at,
        'actions', coalesce((select jsonb_agg(jsonb_build_object(
            'id', a.id, 'friend', private.mini(a.friend_id), 'body', a.body, 'status', a.status, 'chat_id', a.chat_id) order by a.id)
          from public.fo_actions a where a.message_id = m.id), '[]'::jsonb)) order by m.created_at, m.id)
      from public.fo_messages m
      where m.user_id = private.me() and m.chat_id is not distinct from p_chat), '[]'::jsonb))
  from (select 1) one
  left join public.fo_threads t on t.user_id = private.me() and t.chat_id is not distinct from p_chat;
$$;

-- Requests now carry your friend list.
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
    'location', private.fo_location(p_user),
    'friends', private.fo_friends(p_user),
    'others', coalesce((select jsonb_agg(private.display_name(cm.user_id) order by cm.joined_at)
                        from public.chat_members cm
                        where cm.chat_id = p_chat and cm.user_id <> p_user and cm.left_at is null), '[]'::jsonb));
end $$;

revoke execute on function public.my_fo_sharing() from public, anon;
revoke execute on function public.set_fo_sharing(boolean, text, text) from public, anon;
revoke execute on function public.fo_send_action(bigint) from public, anon;
revoke execute on function public.fo_dismiss_action(bigint) from public, anon;
revoke execute on function public.srv_fo_update(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.my_fo_sharing() to authenticated;
grant execute on function public.set_fo_sharing(boolean, text, text) to authenticated;
grant execute on function public.fo_send_action(bigint) to authenticated;
grant execute on function public.fo_dismiss_action(bigint) to authenticated;
grant execute on function public.srv_fo_update(uuid, uuid, text, text, text, jsonb) to service_role;
