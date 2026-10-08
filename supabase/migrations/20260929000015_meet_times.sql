-- ============================================================================
-- Find a time, in a chat (2026-09-29)
--   Step 3 of the Concierge: no AI, just taps.
--   - meet_options: the days you two are in the same city (home or trips,
--     with the same privacy rules as everywhere else).
--   - propose_times: you tap time-of-day slots on those days; they post to the
--     chat as one "times" message (your own picks count as yes).
--   - pick_time: the other person taps the ones that work for them. A slot
--     everyone picked is the time to meet.
--   Direct chats only. The new tables are only reachable through these
--   functions, so nobody can read picks outside their own chats.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'system', 'venue', 'times'));

create table public.meet_slots (
  message_id bigint not null references public.messages(id) on delete cascade,
  day        date not null,
  part       text not null check (part in ('morning', 'lunch', 'evening', 'night')),
  city_id    text not null references public.cities(id),
  primary key (message_id, day, part)
);

create table public.meet_picks (
  message_id bigint not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  part       text not null,
  primary key (message_id, user_id, day, part),
  foreign key (message_id, day, part) references public.meet_slots(message_id, day, part) on delete cascade
);
create index on public.meet_picks (user_id);

alter table public.meet_slots enable row level security;
alter table public.meet_picks enable row level security;
revoke all on public.meet_slots from anon, authenticated;
revoke all on public.meet_picks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Days two people are in the same city, today and the next 60 days.
-- ---------------------------------------------------------------------------
create or replace function private.meet_days(p_me uuid, p_other uuid, p_degree int)
returns table (day date, city_id text)
language sql stable security definer set search_path = '' as $$
  select d::date, mw.city_id
  from generate_series(current_date, current_date + 60, interval '1 day') d
  cross join lateral private.whereabouts(p_me, 0, d::date) mw
  cross join lateral private.whereabouts(p_other, p_degree, d::date) ow
  where p_degree is not null and ow.city_id = mw.city_id;
$$;

-- The other person in a direct chat you can still use, or null.
create or replace function private.meet_partner(p_chat uuid, p_me uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_other uuid;
begin
  if (select ch.kind from public.chats ch where ch.id = p_chat) is distinct from 'direct'
     or not private.is_active_member(p_chat, p_me) then
    return null;
  end if;
  select m.user_id into v_other from public.chat_members m where m.chat_id = p_chat and m.user_id <> p_me;
  if v_other is null or private.is_blocked(p_me, v_other) then return null; end if;
  return v_other;
end $$;

-- ---------------------------------------------------------------------------
-- 2. What the chat shows: stretches of shared days, and the first 14 shared
--    days to pick slots from.
-- ---------------------------------------------------------------------------
create or replace function public.meet_options(p_chat uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_other uuid; v_deg int;
begin
  v_other := private.meet_partner(p_chat, v_me);
  if v_other is null then return null; end if;
  select c.degree into v_deg from private.circle(v_me) c where c.uid = v_other;

  return (
    with md as (select * from private.meet_days(v_me, v_other, v_deg)),
    runs as (
      select x.city_id, min(x.day) as d_from, max(x.day) as d_to
      from (select md.*, md.day - (row_number() over (partition by md.city_id order by md.day))::int as grp from md) x
      group by x.city_id, x.grp
    )
    select jsonb_build_object(
      'runs', coalesce((select jsonb_agg(jsonb_build_object(
                 'city_id', r.city_id, 'city', c.name, 'short', c.short_name,
                 'from', r.d_from, 'to', r.d_to, 'ongoing', r.d_to >= current_date + 60)
               order by r.d_from) from runs r join public.cities c on c.id = r.city_id), '[]'::jsonb),
      'days', coalesce((select jsonb_agg(jsonb_build_object(
                 'day', f.day, 'city_id', f.city_id, 'city', c.name, 'short', c.short_name) order by f.day)
               from (select * from md order by day limit 14) f join public.cities c on c.id = f.city_id), '[]'::jsonb))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. Post the times you tapped.
-- ---------------------------------------------------------------------------
create or replace function public.propose_times(p_chat uuid, p_slots jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me(); v_other uuid; v_deg int; v_id bigint; v_cities text; v_slots jsonb;
begin
  v_other := private.meet_partner(p_chat, v_me);
  if v_other is null then raise exception 'Not available'; end if;
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) not between 1 and 24 then
    raise exception 'Pick between 1 and 24 times';
  end if;
  select c.degree into v_deg from private.circle(v_me) c where c.uid = v_other;

  select jsonb_agg(distinct jsonb_build_object('day', (s ->> 'day')::date, 'part', s ->> 'part'))
  into v_slots from jsonb_array_elements(p_slots) s;
  if exists (select 1 from jsonb_to_recordset(v_slots) as t(day date, part text)
             where part is null or part not in ('morning', 'lunch', 'evening', 'night')) then
    raise exception 'That is not a time of day';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_slots) as t(day date, part text)
             where not exists (select 1 from private.meet_days(v_me, v_other, v_deg) md where md.day = t.day)) then
    raise exception 'Those days are not in a city you will both be in';
  end if;

  select string_agg(distinct c.name, ' / ') into v_cities
  from jsonb_to_recordset(v_slots) as t(day date, part text)
  join private.meet_days(v_me, v_other, v_deg) md on md.day = t.day
  join public.cities c on c.id = md.city_id;

  insert into public.messages (chat_id, sender_id, kind, body)
  values (p_chat, v_me, 'times', 'Suggested times to meet in ' || v_cities) returning id into v_id;
  insert into public.meet_slots (message_id, day, part, city_id)
  select v_id, t.day, t.part, md.city_id
  from jsonb_to_recordset(v_slots) as t(day date, part text)
  join private.meet_days(v_me, v_other, v_deg) md on md.day = t.day;
  insert into public.meet_picks (message_id, user_id, day, part)
  select v_id, v_me, t.day, t.part from jsonb_to_recordset(v_slots) as t(day date, part text);

  update public.chats set last_message_at = now() where id = p_chat;
  update public.chat_members set last_read_at = now() where chat_id = p_chat and user_id = v_me;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tap a suggested time to say it works (or tap again to take it back).
--    The message is touched so the other person's open chat refreshes.
-- ---------------------------------------------------------------------------
create or replace function public.pick_time(p_message bigint, p_day date, p_part text, p_on boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_chat uuid;
begin
  select m.chat_id into v_chat from public.messages m where m.id = p_message and m.kind = 'times';
  if v_chat is null or private.meet_partner(v_chat, v_me) is null then raise exception 'Not available'; end if;
  if not exists (select 1 from public.meet_slots s where s.message_id = p_message and s.day = p_day and s.part = p_part) then
    raise exception 'That time was not suggested';
  end if;
  if p_day < current_date then raise exception 'That day has passed'; end if;

  if p_on then
    insert into public.meet_picks (message_id, user_id, day, part) values (p_message, v_me, p_day, p_part)
    on conflict do nothing;
  else
    delete from public.meet_picks where message_id = p_message and user_id = v_me and day = p_day and part = p_part;
  end if;
  update public.messages set body = body where id = p_message;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Every "times" message in a chat, with who picked what.
-- ---------------------------------------------------------------------------
create or replace function public.meet_state(p_chat uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if private.meet_partner(p_chat, v_me) is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('message_id', m.id, 'options', (
      select jsonb_agg(jsonb_build_object(
        'day', s.day, 'part', s.part, 'city_id', s.city_id, 'city', c.name,
        'by', (select coalesce(jsonb_agg(p.user_id), '[]'::jsonb) from public.meet_picks p
               where p.message_id = s.message_id and p.day = s.day and p.part = s.part))
        order by s.day, array_position(array['morning', 'lunch', 'evening', 'night'], s.part))
      from public.meet_slots s join public.cities c on c.id = s.city_id
      where s.message_id = m.id)) order by m.id)
    from public.messages m where m.chat_id = p_chat and m.kind = 'times'), '[]'::jsonb);
end $$;

revoke execute on function private.meet_days(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function private.meet_partner(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.meet_options(uuid) from public, anon;
revoke execute on function public.propose_times(uuid, jsonb) from public, anon;
revoke execute on function public.pick_time(bigint, date, text, boolean) from public, anon;
revoke execute on function public.meet_state(uuid) from public, anon;
grant execute on function public.meet_options(uuid) to authenticated;
grant execute on function public.propose_times(uuid, jsonb) to authenticated;
grant execute on function public.pick_time(bigint, date, text, boolean) to authenticated;
grant execute on function public.meet_state(uuid) to authenticated;
