-- A trip's inbound/outbound journey can be several connecting flights.
-- `leg` orders them within a direction (1 = first flight flown).
alter table public.trip_flights
  add column leg smallint not null default 1 check (leg between 1 and 4);

alter table public.trip_flights drop constraint trip_flights_trip_id_direction_key;
alter table public.trip_flights add constraint trip_flights_trip_dir_leg_key unique (trip_id, direction, leg);

-- Deliveries care about the final arrival, i.e. the last flight of the journey.
create or replace function private.delivery_helpers(p_me uuid, p_from text, p_to text, p_by date, p_scope text, p_after date)
returns table (user_id uuid, trip_id uuid, leg text, arrives_on date, space text)
language sql stable security definer set search_path = '' as $$
  select x.user_id, x.trip_id, x.leg, x.arrives_on, x.space from (
    select t.user_id, t.id as trip_id, 'in'::text as leg,
           coalesce((select max(f.flight_date) from public.trip_flights f where f.trip_id = t.id and f.direction = 'in'), t.starts_on) as arrives_on,
           t.deliver_space as space
    from public.trips t join public.profiles pr on pr.id = t.user_id
    where t.deliver_open and t.deliver_legs in ('in', 'both')
      and pr.home_city_id = p_from and t.city_id = p_to
    union all
    select t.user_id, t.id, 'out',
           coalesce((select max(f.flight_date) from public.trip_flights f where f.trip_id = t.id and f.direction = 'out'), t.ends_on),
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
