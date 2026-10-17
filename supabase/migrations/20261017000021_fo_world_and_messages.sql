-- ============================================================================
-- Fo sees your World, and can draft messages to your friends (2026-10-17)
--   - srv_fo_world: the same saved friends the World page shows, city by city,
--     so Fo can answer "who do I know in New York?".
--   - Fo can't send Friend Flower messages itself. It drafts one for a list of
--     friends (fo_sends); you see who it would go to and tap Send. Nothing is
--     sent until you do, and only to your saved friends.
-- ============================================================================

create table public.fo_sends (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  chat_id    uuid references public.chats(id) on delete cascade,
  recipients uuid[] not null,
  body       text not null check (char_length(body) between 1 and 1000),
  status     text not null default 'pending' check (status in ('pending', 'sent', 'dismissed')),
  created_at timestamptz not null default now()
);
alter table public.fo_sends enable row level security;
revoke all on public.fo_sends from anon, authenticated;

-- Server only: your saved friends by city (where they live, are visiting, or
-- are headed in the next 120 days), as the World page lists them.
create or replace function public.srv_fo_world(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with friends as (
    select case when r.from_id = p_user then r.to_id else r.from_id end as uid
    from public.friend_requests r
    where r.status = 'accepted' and (r.from_id = p_user or r.to_id = p_user)
  ),
  visible as (
    select f.uid, c.degree from friends f join private.circle(p_user) c on c.uid = f.uid
  ),
  spots as (
    select v.uid, w.city_id, w.presence, w.trip_start, w.trip_end
    from visible v, lateral private.whereabouts(v.uid, v.degree, current_date) w
    union all
    select v.uid, t.city_id, 'upcoming', t.starts_on, t.ends_on
    from visible v
    join public.trips t on t.user_id = v.uid
    join public.profiles pr on pr.id = v.uid
    where t.starts_on > current_date and t.starts_on <= current_date + 120
      and private.trip_visible(t.visibility, pr.show_trips, v.degree)
  ),
  by_city as (
    select s.city_id, count(*) as n,
      jsonb_agg(jsonb_build_object(
        'id', s.uid, 'name', private.display_name(s.uid), 'presence', s.presence,
        'from', s.trip_start, 'until', s.trip_end) order by s.presence, private.display_name(s.uid)) as people
    from spots s group by s.city_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('city', c.name, 'people', b.people) order by b.n desc), '[]'::jsonb)
  from by_city b join public.cities c on c.id = b.city_id;
$$;

-- Server only: save a drafted message. Only your saved friends can be on it.
create or replace function public.srv_fo_propose(p_user uuid, p_chat uuid, p_text text, p_recipients uuid[])
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_id bigint;
begin
  select coalesce(array_agg(distinct u), '{}') into v_ids
  from unnest(p_recipients) u
  where exists (select 1 from public.friend_requests r
                where r.status = 'accepted'
                  and ((r.from_id = p_user and r.to_id = u) or (r.to_id = p_user and r.from_id = u)))
    and not private.is_blocked(p_user, u);
  v_ids := v_ids[1:50];
  if coalesce(array_length(v_ids, 1), 0) = 0 or coalesce(trim(p_text), '') = '' then return null; end if;
  -- Replace an older draft that was never answered.
  update public.fo_sends set status = 'dismissed'
  where user_id = p_user and chat_id is not distinct from p_chat and status = 'pending';
  insert into public.fo_sends (user_id, chat_id, recipients, body)
  values (p_user, p_chat, v_ids, left(trim(p_text), 1000)) returning id into v_id;
  return v_id;
end $$;

-- Your thread with Fo, plus any message Fo has drafted that's waiting on you.
create or replace function public.fo_thread(p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(t.status, 'idle'),
    'progress', t.progress,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.fo_messages m
      where m.user_id = private.me() and m.chat_id is not distinct from p_chat), '[]'::jsonb),
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'body', s.body,
        'people', (select jsonb_agg(private.mini(u)) from unnest(s.recipients) u)) order by s.id)
      from public.fo_sends s
      where s.user_id = private.me() and s.chat_id is not distinct from p_chat
        and s.status = 'pending' and s.created_at > now() - interval '1 day'), '[]'::jsonb))
  from (select 1) one
  left join public.fo_threads t on t.user_id = private.me() and t.chat_id is not distinct from p_chat;
$$;

-- You tapped Send: message each friend directly, as you.
create or replace function public.fo_send_proposal(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_row public.fo_sends; v_to uuid; v_chat uuid; v_sent int := 0;
begin
  select * into v_row from public.fo_sends where id = p_id and user_id = v_me and status = 'pending' for update;
  if not found then raise exception 'That message was already handled'; end if;
  update public.fo_sends set status = 'sent' where id = p_id;
  foreach v_to in array v_row.recipients loop
    begin
      v_chat := public.open_direct_chat(v_to);
      perform public.send_message(v_chat, v_row.body);
      v_sent := v_sent + 1;
    exception when others then
      null; -- blocked, or no longer in your circle: skip them
    end;
  end loop;
  return jsonb_build_object('sent', v_sent, 'skipped', cardinality(v_row.recipients) - v_sent);
end $$;

create or replace function public.fo_dismiss_proposal(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.fo_sends set status = 'dismissed' where id = p_id and user_id = private.me() and status = 'pending';
$$;

revoke execute on function public.srv_fo_world(uuid) from public, anon, authenticated;
revoke execute on function public.srv_fo_propose(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.srv_fo_world(uuid) to service_role;
grant execute on function public.srv_fo_propose(uuid, uuid, text, uuid[]) to service_role;
revoke execute on function public.fo_thread(uuid) from public, anon;
revoke execute on function public.fo_send_proposal(bigint) from public, anon;
revoke execute on function public.fo_dismiss_proposal(bigint) from public, anon;
grant execute on function public.fo_thread(uuid) to authenticated;
grant execute on function public.fo_send_proposal(bigint) to authenticated;
grant execute on function public.fo_dismiss_proposal(bigint) to authenticated;
