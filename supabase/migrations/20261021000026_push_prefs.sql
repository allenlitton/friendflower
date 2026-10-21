-- ============================================================================
-- Notification choices (2026-10-21)
--   Members choose which notifications they get (new messages, friend
--   requests) and whether the app icon shows how many messages they haven't
--   read. Everything is on by default. How notifications look (banners, lock
--   screen, sounds) is chosen in the iPhone's own Settings app, not here.
--   The icon number travels with each notification as the APNs "badge"; the
--   app clears it when opened.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.push_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages boolean not null default true,
  friend_requests boolean not null default true,
  badge boolean not null default true,
  updated_at timestamptz not null default now()
);
revoke all on private.push_prefs from public, anon, authenticated;

alter table private.push_outbox add column badge int;

-- Messages from other people you haven't read yet, counted the way the Chats
-- list marks chats unread (hidden or deleted history and blocked direct chats don't count).
create or replace function private.unread_count(p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.chat_members me
  join public.messages msg on msg.chat_id = me.chat_id
  where me.user_id = p_user
    and msg.sender_id is not null and msg.sender_id <> p_user
    and msg.created_at > me.last_read_at
    and msg.created_at <= coalesce(me.left_at, 'infinity')
    and msg.created_at > coalesce(me.cleared_at, '-infinity')
    and not exists (
      select 1 from public.chats ch join public.chat_members o on o.chat_id = ch.id
      where ch.id = me.chat_id and ch.kind = 'direct' and o.user_id <> p_user
        and private.is_blocked(p_user, o.user_id));
$$;

-- Replaces the version from 20261020000025: also checks the member's choices
-- and adds the unread count when they want it on the app icon.
drop function private.push_enqueue(uuid, text, text, text);
create function private.push_enqueue(p_user uuid, p_kind text, p_title text, p_body text, p_url text)
returns void language sql security definer set search_path = '' as $$
  insert into private.push_outbox (user_id, title, body, url, badge)
  select p_user, p_title, left(p_body, 140), p_url,
         case when coalesce(pr.badge, true) then private.unread_count(p_user) end
  from (select 1) one
  left join private.push_prefs pr on pr.user_id = p_user
  where exists (select 1 from private.push_tokens t where t.user_id = p_user)
    and case p_kind
          when 'message' then coalesce(pr.messages, true)
          when 'friend_request' then coalesce(pr.friend_requests, true)
          else true
        end;
$$;

create or replace function private.push_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.sender_id is null or new.kind = 'system' then return null; end if;
  for m in
    select cm.user_id from public.chat_members cm
    where cm.chat_id = new.chat_id and cm.left_at is null and cm.user_id <> new.sender_id
      and not private.is_blocked(new.sender_id, cm.user_id)
  loop
    perform private.push_enqueue(m.user_id, 'message', private.display_name(new.sender_id),
      case when new.kind = 'venue' then 'Suggested a place: ' || new.body else new.body end,
      '/chat/' || new.chat_id);
  end loop;
  return null;
end $$;

create or replace function private.push_on_friend_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.push_enqueue(new.to_id, 'friend_request', private.display_name(new.from_id), 'wants to be friends', '/chats');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.push_enqueue(new.from_id, 'friend_request', private.display_name(new.to_id), 'accepted your friend request', '/people/' || new.to_id);
  end if;
  return null;
end $$;

create or replace function public.srv_push_claim(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  delete from private.push_outbox where created_at < now() - interval '1 day';
  with taken as (
    delete from private.push_outbox o
    where o.id in (select id from private.push_outbox order by id limit p_limit for update skip locked)
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'title', t.title, 'body', t.body, 'url', t.url, 'badge', t.badge,
    'tokens', (select coalesce(jsonb_agg(jsonb_build_object('token', k.token, 'env', k.env)), '[]'::jsonb)
               from private.push_tokens k where k.user_id = t.user_id)
  ) order by t.id), '[]'::jsonb) into v_out from taken t;
  return v_out;
end $$;

-- For the Settings page.
create or replace function public.my_push_prefs()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'messages', coalesce(pr.messages, true),
    'friend_requests', coalesce(pr.friend_requests, true),
    'badge', coalesce(pr.badge, true))
  from (select 1) one
  left join private.push_prefs pr on pr.user_id = private.me();
$$;

create or replace function public.set_push_prefs(p_messages boolean, p_friend_requests boolean, p_badge boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if v_me is null then raise exception 'Please sign in'; end if;
  insert into private.push_prefs (user_id, messages, friend_requests, badge)
  values (v_me, p_messages, p_friend_requests, p_badge)
  on conflict (user_id) do update
    set messages = excluded.messages, friend_requests = excluded.friend_requests,
        badge = excluded.badge, updated_at = now();
end $$;

revoke execute on function private.push_enqueue(uuid, text, text, text, text), private.unread_count(uuid)
  from public, anon, authenticated;
revoke execute on function public.my_push_prefs(), public.set_push_prefs(boolean, boolean, boolean) from public, anon;
grant execute on function public.my_push_prefs(), public.set_push_prefs(boolean, boolean, boolean) to authenticated;
