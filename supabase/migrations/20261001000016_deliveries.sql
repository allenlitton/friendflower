-- ============================================================================
-- Trips & Deliveries (2026-10-01)
--   - A trip can say "I'm open to carrying a small package", on the way there
--     (inbound), the way back (outbound) or either, and how much room is spare.
--   - request_delivery: someone needs a package taken from one city to another
--     by a date. We search the whole network for a trip that fits and open a
--     chat with the best match. Only people who opted in on a trip can be found.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

alter table public.trips
  add column deliver_open     boolean not null default false,
  add column deliver_legs     text check (deliver_legs in ('in', 'out', 'both')),
  add column deliver_luggage  boolean,
  add column deliver_space    text check (deliver_space in ('little', 'some', 'lot')),
  add constraint trips_deliver_check check (
    (not deliver_open and deliver_legs is null and deliver_luggage is null and deliver_space is null)
    or (deliver_open and deliver_legs is not null and deliver_luggage is not null
        and (deliver_luggage = (deliver_space is not null)))
  );

-- Who can take a package from p_from to p_to so it lands by p_by?
--   inbound:  lives in p_from, visiting p_to, arriving by p_by
--   outbound: lives in p_to, visiting p_from, flying home by p_by
create or replace function private.delivery_helpers(p_me uuid, p_from text, p_to text, p_by date, p_scope text, p_after date)
returns table (user_id uuid, trip_id uuid, leg text, arrives_on date, space text)
language sql stable security definer set search_path = '' as $$
  select x.user_id, x.trip_id, x.leg, x.arrives_on, x.space from (
    select t.user_id, t.id as trip_id, 'in'::text as leg,
           coalesce((select f.flight_date from public.trip_flights f where f.trip_id = t.id and f.direction = 'in'), t.starts_on) as arrives_on,
           t.deliver_space as space
    from public.trips t join public.profiles pr on pr.id = t.user_id
    where t.deliver_open and t.deliver_legs in ('in', 'both')
      and pr.home_city_id = p_from and t.city_id = p_to
    union all
    select t.user_id, t.id, 'out',
           coalesce((select f.flight_date from public.trip_flights f where f.trip_id = t.id and f.direction = 'out'), t.ends_on),
           t.deliver_space
    from public.trips t join public.profiles pr on pr.id = t.user_id
    where t.deliver_open and t.deliver_legs in ('out', 'both')
      and pr.home_city_id = p_to and t.city_id = p_from
  ) x
  join public.profiles h on h.id = x.user_id
  where x.user_id <> p_me and h.onboarded_at is not null
    and x.arrives_on >= greatest(current_date, coalesce(p_after, current_date)) and x.arrives_on <= p_by
    and not private.is_blocked(p_me, x.user_id)
    and (p_scope = 'network' or exists (select 1 from private.circle(p_me) c where c.uid = x.user_id));
$$;

-- p_after: optional start of a flexible window (arrive between p_after and p_by).
-- p_scope: 'network' = everyone who opted in, 'circle' = only your 1st/2nd degree.
-- Finds the best match (most spare room, then soonest) and opens a chat with
-- them. Returns null when nobody fits. Works across the whole network, so the
-- chat can be with someone outside your circle: only people who opted in.
create or replace function public.request_delivery(p_from text, p_to text, p_by date, p_scope text default 'network', p_after date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_h record; v_key text; v_chat uuid;
begin
  if p_scope not in ('network', 'circle') then raise exception 'Pick network or circle'; end if;
  if p_from = p_to then raise exception 'Pick two different cities'; end if;
  if p_after is not null and p_after > p_by then raise exception 'The start date must be before the end date'; end if;
  if p_by < current_date then raise exception 'Pick a date that is today or later'; end if;
  select * into v_h from private.delivery_helpers(v_me, p_from, p_to, p_by, p_scope, p_after) d
  order by case d.space when 'lot' then 0 when 'some' then 1 else 2 end, d.arrives_on, d.user_id
  limit 1;
  if v_h.user_id is null then return null; end if;

  v_key := least(v_me::text, v_h.user_id::text) || ':' || greatest(v_me::text, v_h.user_id::text);
  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is null then
    insert into public.chats (kind, direct_key) values ('direct', v_key) returning id into v_chat;
    insert into public.chat_members (chat_id, user_id) values (v_chat, v_me), (v_chat, v_h.user_id);
  end if;
  return jsonb_build_object('chat', v_chat, 'helper', private.display_name(v_h.user_id), 'arrives_on', v_h.arrives_on);
end $$;

revoke execute on function private.delivery_helpers(uuid, text, text, date, text, date) from public, anon, authenticated;
revoke all on function public.request_delivery(text, text, date, text, date) from public, anon;
grant execute on function public.request_delivery(text, text, date, text, date) to authenticated;
