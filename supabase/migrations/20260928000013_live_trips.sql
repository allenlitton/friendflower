-- ============================================================================
-- Live distance keeps your current city up to date (2026-09-28)
--   When live distance is on and your position lands in a city other than
--   the one you live in, a trip there starts automatically (today to today),
--   so World, Nearby and your profile say you're visiting it. The app then
--   asks "Visiting San Francisco? Set your trip dates (optional)".
--
--   - A trip made this way is marked from_live. It is stretched to today each
--     day you're still there, and ended (yesterday) once you're back home or
--     in another city. Trips you add yourself are never touched.
--   - live_asked records that you've answered the dates question, either way.
--   - The city is worked out on the server from the rounded position; no
--     coordinates are ever stored on the trip.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

alter table public.trips add column if not exists from_live boolean not null default false;
alter table public.trips add column if not exists live_asked boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Which city a position is in: home if you're within 25 miles of it,
--    else the nearest city centre within 60 miles (else unknown).
-- ---------------------------------------------------------------------------
create or replace function private.city_at(p_user uuid, p_lat double precision, p_lng double precision)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.id from public.profiles pr join public.cities c on c.id = pr.home_city_id
     where pr.id = p_user and private.miles(p_lat, p_lng, c.lat, c.lng) < 25),
    (select c.id from public.cities c
     where private.miles(p_lat, p_lng, c.lat, c.lng) < 60
     order by private.miles(p_lat, p_lng, c.lat, c.lng) limit 1));
$$;

-- ---------------------------------------------------------------------------
-- 2. Keep live trips in step with where you are.
-- ---------------------------------------------------------------------------
create or replace function private.sync_live_trip(p_user uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_city text := private.city_at(p_user, p_lat, p_lng);
  v_home text;
  v_trip public.trips;
begin
  if v_city is null then return; end if;  -- somewhere we don't know: leave things be
  select pr.home_city_id into v_home from public.profiles pr where pr.id = p_user;

  -- Live trips elsewhere that still run today are over: you're not there now.
  delete from public.trips t
  where t.user_id = p_user and t.from_live and t.city_id <> v_city
    and t.starts_on >= current_date and t.ends_on >= current_date;
  update public.trips t set ends_on = current_date - 1
  where t.user_id = p_user and t.from_live and t.city_id <> v_city
    and t.starts_on < current_date and t.ends_on >= current_date;

  if v_city is not distinct from v_home then return; end if;

  -- Already covered today by a trip there (yours or a live one)?
  if exists (select 1 from public.trips t
             where t.user_id = p_user and t.city_id = v_city
               and t.starts_on <= current_date and t.ends_on >= current_date) then
    return;
  end if;

  -- Still there from a live trip that ended in the last week: carry it on.
  select * into v_trip from public.trips t
  where t.user_id = p_user and t.from_live and t.city_id = v_city
    and t.ends_on between current_date - 7 and current_date - 1
    and current_date - t.starts_on <= 366
  order by t.ends_on desc limit 1;
  if found then
    update public.trips set ends_on = current_date where id = v_trip.id;
    return;
  end if;

  insert into public.trips (user_id, city_id, starts_on, ends_on, from_live)
  values (p_user, v_city, current_date, current_date, true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. update_location: same as 20260927000006_live_distance.sql, plus the
--    sync above once a position is saved.
-- ---------------------------------------------------------------------------
create or replace function public.update_location(p_lat double precision, p_lng double precision,
                                                  p_accuracy_m double precision default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_prev private.live_locations;
  v_lat double precision;
  v_lng double precision;
  v_hours double precision;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That location is not valid';
  end if;
  if not exists (select 1 from public.profiles pr
                 where pr.id = v_me and pr.share_live_location and pr.show_distance) then
    return false;
  end if;
  -- A fix this rough would make the distance misleading; keep the last good one.
  if p_accuracy_m is not null and p_accuracy_m > 500 then return false; end if;

  -- Round to 3 decimal places (~100 m) before storing anything.
  v_lat := round(p_lat::numeric, 3)::double precision;
  v_lng := round(p_lng::numeric, 3)::double precision;

  -- Stale positions are useless, so don't keep them.
  delete from private.live_locations where updated_at < now() - interval '30 minutes';

  select * into v_prev from private.live_locations where user_id = v_me;
  if found then
    -- At most one update every 20 seconds...
    if v_prev.updated_at > now() - interval '20 seconds' then return false; end if;
    -- ...and no teleporting within the 30-minute window.
    v_hours := extract(epoch from now() - v_prev.updated_at) / 3600;
    if private.miles(v_prev.lat, v_prev.lng, v_lat, v_lng) / v_hours > 100 then return false; end if;
  end if;

  insert into private.live_locations (user_id, lat, lng, updated_at)
  values (v_me, v_lat, v_lng, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at;

  perform private.sync_live_trip(v_me, v_lat, v_lng);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Where someone is: a live trip covering today beats a planned one, since
--    it's where they actually are. Otherwise as before.
-- ---------------------------------------------------------------------------
create or replace function private.whereabouts(p_user uuid, p_degree int, p_on date)
returns table (city_id text, neighbourhood_id text, presence text, trip_start date, trip_end date)
language sql stable security definer set search_path = '' as $$
  select x.city_id, x.neighbourhood_id, x.presence, x.trip_start, x.trip_end
  from (
    select t.city_id, t.neighbourhood_id, 'visiting' as presence,
           t.starts_on as trip_start, t.ends_on as trip_end, 0 as ord, t.from_live
    from public.trips t join public.profiles pr on pr.id = t.user_id
    where t.user_id = p_user and p_on between t.starts_on and t.ends_on
      and (p_degree = 0 or private.trip_visible(t.visibility, pr.show_trips, p_degree))
    union all
    select pr.home_city_id, pr.home_neighbourhood_id, 'lives', null::date, null::date, 1, false
    from public.profiles pr
    where pr.id = p_user and pr.home_city_id is not null
  ) x
  order by x.ord, x.from_live desc, x.trip_start desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. The live trip the app should ask about, if any.
-- ---------------------------------------------------------------------------
create or replace function public.live_trip_to_confirm()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'city_id', t.city_id, 'city', c.name,
                            'starts_on', t.starts_on, 'ends_on', t.ends_on)
  from public.trips t join public.cities c on c.id = t.city_id
  where t.user_id = private.me() and t.from_live and not t.live_asked
    and t.starts_on <= current_date and t.ends_on >= current_date
  order by t.starts_on desc limit 1;
$$;

revoke execute on function private.city_at(uuid, double precision, double precision) from public, anon, authenticated;
revoke execute on function private.sync_live_trip(uuid, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.live_trip_to_confirm() from public, anon;
grant execute on function public.live_trip_to_confirm() to authenticated;
