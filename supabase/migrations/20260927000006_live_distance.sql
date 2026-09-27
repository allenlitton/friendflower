-- ============================================================================
-- Live distance (2026-09-27)
--   People can choose to share their live position while the app is open.
--   When two people in the same city both share, Nearby and profiles show the
--   real distance between them (to 0.1 mi) instead of neighbourhood centres.
--
--   Privacy:
--   - Off by default (profiles.share_live_location), and only works while
--     "Show my distance" is on too. Turning either off erases the position.
--   - Only the latest position is kept, rounded to ~100 m, in the private
--     schema. No function ever returns anyone's coordinates, only distances.
--   - A position older than 30 minutes is ignored (and erased), so distance
--     falls back to neighbourhoods when someone closes the app.
--   - Updates are limited to one every 20 seconds and jumps faster than
--     100 mph are ignored, which makes faking positions to triangulate
--     someone slow.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The setting and where the position is kept
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists share_live_location boolean not null default false;

create table if not exists private.live_locations (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now()
);
alter table private.live_locations enable row level security;
revoke all on private.live_locations from public, anon, authenticated;

-- Turning off live location or distance erases the stored position.
create or replace function private.clear_live_location()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.share_live_location or not new.show_distance then
    delete from private.live_locations where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_clear_live on public.profiles;
create trigger profiles_clear_live
  after update of share_live_location, show_distance on public.profiles
  for each row execute function private.clear_live_location();

-- Someone's live position in a city, if they share it, it's fresh, and they
-- are actually in (or around) that city. Never returned to the app directly.
create or replace function private.live_point(p_user uuid, p_city text)
returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = '' as $$
  select l.lat, l.lng
  from private.live_locations l
  join public.profiles pr on pr.id = l.user_id
  join public.cities c on c.id = p_city
  where l.user_id = p_user
    and pr.share_live_location and pr.show_distance
    and l.updated_at > now() - interval '30 minutes'
    and private.miles(l.lat, l.lng, c.lat, c.lng) < 60;
$$;

-- ---------------------------------------------------------------------------
-- 2. The app reports your position (every so often, while it's open)
--    Returns true if it was saved, false if it was skipped.
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
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Nearby uses live distance when both people share one
-- ---------------------------------------------------------------------------
create or replace function public.circle_in_city(p_city text, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, p_from, current_date);
  v_my_nb text;
  v_my_lat double precision; v_my_lng double precision;
  v_live_lat double precision; v_live_lng double precision;
  v_result jsonb;
begin
  -- Where am I in this city? (my trip there, else my home there)
  select t.neighbourhood_id into v_my_nb from public.trips t
  where t.user_id = v_me and t.city_id = p_city and t.starts_on <= v_to and t.ends_on >= v_from
  order by t.starts_on limit 1;

  if not found then
    if not exists (select 1 from public.profiles pr where pr.id = v_me and pr.home_city_id = p_city) then
      raise exception 'You can see the city you live in, or cities you have a trip to';
    end if;
    select pr.home_neighbourhood_id into v_my_nb from public.profiles pr where pr.id = v_me;
  end if;

  select n.lat, n.lng into v_my_lat, v_my_lng from public.neighbourhoods n where n.id = v_my_nb;

  -- My live position, if I share one and I'm looking at today (not a future trip).
  if v_from <= current_date and v_to >= current_date then
    select lp.lat, lp.lng into v_live_lat, v_live_lng from private.live_point(v_me, p_city) lp;
  end if;

  with c as (select * from private.circle(v_me)),
  here as (
    -- visiting during the window, on a trip this viewer may see
    select c.uid, c.degree, c.vias, c.via_kind, c.via_school,
           'visiting' as presence, t.starts_on, t.ends_on, t.neighbourhood_id as nb
    from c
    join public.trips t on t.user_id = c.uid
    join public.profiles pr on pr.id = c.uid
    where t.city_id = p_city and t.starts_on <= v_to and t.ends_on >= v_from
      and private.trip_visible(t.visibility, pr.show_trips, c.degree)
    union all
    -- based here, and not (visibly) away for the whole window
    select c.uid, c.degree, c.vias, c.via_kind, c.via_school,
           'lives', null, null, pr.home_neighbourhood_id
    from c
    join public.profiles pr on pr.id = c.uid
    where pr.home_city_id = p_city
      and not exists (
        select 1 from public.trips t
        where t.user_id = c.uid and t.city_id <> p_city
          and t.starts_on <= v_from and t.ends_on >= v_to
          and private.trip_visible(t.visibility, pr.show_trips, c.degree)
      )
  ),
  one as (
    select distinct on (h.uid) h.* from here h
    order by h.uid, (h.presence = 'visiting') desc, h.starts_on
  ),
  res as (
    select
      o.uid, o.degree, o.via_kind, o.via_school, o.presence, o.starts_on, o.ends_on,
      pr.first_name, private.display_name(o.uid) as name, pr.avatar_url,
      private.is_online(o.uid) as online,
      -- Live distance when we both share a live position here, else neighbourhood centres.
      case when not pr.show_distance then null
           when lp.lat is not null
             then round(private.miles(v_live_lat, v_live_lng, lp.lat, lp.lng)::numeric, 1)
           when v_my_lat is not null and n.lat is not null
             then round(private.miles(v_my_lat, v_my_lng, n.lat, n.lng)::numeric, 1) end as distance_mi,
      (pr.show_distance and lp.lat is not null) as distance_live,
      case when pr.show_distance then n.name end as neighbourhood,
      case when o.degree = 1
           then (select count(*) from private.first_degree(v_me) a
                 join private.first_degree(o.uid) b on a.uid = b.uid)
           else cardinality(o.vias) end as mutual_count,
      (select jsonb_agg(private.display_name(v)) from (select unnest(o.vias[1:3]) v) x) as via_names,
      private.is_friend(v_me, o.uid) as is_friend,
      private.pair_verification(v_me, o.uid) is not null as verified
    from one o
    join public.profiles pr on pr.id = o.uid
    left join public.neighbourhoods n on n.id = o.nb
    left join lateral private.live_point(o.uid, p_city) lp on v_live_lat is not null
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.distance_mi nulls last, r.degree, r.first_name), '[]'::jsonb)
  into v_result
  from res r;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Profiles too
-- ---------------------------------------------------------------------------
create or replace function public.person(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_deg int; v_vias uuid[]; v_via_kind text; v_via_school text;
  v_pr public.profiles;
  v_their record; v_mine record;
  v_their_city public.cities; v_my_city public.cities;
  v_their_nb public.neighbourhoods; v_my_nb public.neighbourhoods;
  v_distance numeric; v_distance_kind text; v_distance_live boolean := false;
  v_me_lat double precision; v_me_lng double precision;
  v_them_lat double precision; v_them_lng double precision;
  v_mutuals jsonb;
  v_result jsonb;
begin
  if p_id = v_me then
    v_deg := 0;
  else
    select c.degree, c.vias, c.via_kind, c.via_school into v_deg, v_vias, v_via_kind, v_via_school
    from private.circle(v_me) c where c.uid = p_id;
    if v_deg is null then return null; end if;
  end if;

  select * into v_pr from public.profiles where id = p_id;

  -- Where are they now, and where am I?
  select * into v_their from private.whereabouts(p_id, v_deg, current_date);
  select * into v_mine  from private.whereabouts(v_me, 0, current_date);
  select * into v_their_city from public.cities where id = v_their.city_id;
  select * into v_my_city    from public.cities where id = v_mine.city_id;
  select * into v_their_nb   from public.neighbourhoods where id = v_their.neighbourhood_id;
  select * into v_my_nb      from public.neighbourhoods where id = v_mine.neighbourhood_id;

  if v_deg > 0 and v_pr.show_distance and v_their_city.id is not null and v_my_city.id is not null then
    if v_their_city.id = v_my_city.id then
      -- Live distance when we both share a live position in this city.
      select lp.lat, lp.lng into v_me_lat, v_me_lng from private.live_point(v_me, v_my_city.id) lp;
      if v_me_lat is not null then
        select lp.lat, lp.lng into v_them_lat, v_them_lng from private.live_point(p_id, v_my_city.id) lp;
      end if;
      if v_them_lat is not null then
        v_distance := round(private.miles(v_me_lat, v_me_lng, v_them_lat, v_them_lng)::numeric, 1);
        v_distance_kind := 'nearby';
        v_distance_live := true;
      elsif v_their_nb.id is not null and v_my_nb.id is not null then
        v_distance := round(private.miles(v_my_nb.lat, v_my_nb.lng, v_their_nb.lat, v_their_nb.lng)::numeric, 1);
        v_distance_kind := 'nearby';
      else
        v_distance_kind := 'same_city';
      end if;
    else
      v_distance := round(private.miles(v_my_city.lat, v_my_city.lng, v_their_city.lat, v_their_city.lng)::numeric);
      v_distance_kind := 'far';
    end if;
  end if;

  -- Mutual friends: for 1st degree, people you both know; for 2nd, the link(s).
  if v_deg = 1 then
    select coalesce(jsonb_agg(private.mini(a.uid)), '[]') into v_mutuals
    from private.first_degree(v_me) a join private.first_degree(p_id) b on a.uid = b.uid;
  elsif v_deg = 2 then
    select coalesce(jsonb_agg(private.mini(u)), '[]') into v_mutuals from unnest(v_vias) u;
  else
    v_mutuals := '[]';
  end if;

  v_result := jsonb_build_object(
    'id', v_pr.id,
    'first_name', v_pr.first_name,
    'name', private.display_name(v_pr.id),
    'avatar_url', v_pr.avatar_url,
    'bio', v_pr.bio,
    'hometown', v_pr.hometown,
    'age', case when v_pr.birth_year is not null then extract(year from current_date)::int - v_pr.birth_year end,
    'languages', to_jsonb(v_pr.languages),
    'spots', to_jsonb(v_pr.spots),
    'instagram', v_pr.instagram,
    'facebook', v_pr.facebook,
    'is_me', v_deg = 0,
    'degree', v_deg,
    'via_kind', v_via_kind,
    'via_school', v_via_school,
    'mutuals', v_mutuals,
    'online', case when v_deg = 0 then v_pr.show_online else private.is_online(p_id) end,
    'now', case when v_their_city.id is not null then jsonb_build_object(
        'city_id', v_their_city.id, 'city', v_their_city.name, 'short', v_their_city.short_name,
        'presence', v_their.presence, 'until', v_their.trip_end,
        'neighbourhood', case when v_deg = 0 or v_pr.show_distance then v_their_nb.name end) end,
    'distance_mi', v_distance,
    'distance_kind', v_distance_kind,
    'distance_live', v_distance_live,
    'home', (select jsonb_build_object('city_id', c.id, 'city', c.name, 'short', c.short_name)
             from public.cities c where c.id = v_pr.home_city_id),
    'trips', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'city_id', t.city_id, 'city', c.name, 'starts_on', t.starts_on, 'ends_on', t.ends_on)
             order by t.starts_on), '[]')
      from public.trips t join public.cities c on c.id = t.city_id
      where t.user_id = p_id and t.ends_on >= current_date
        and (v_deg = 0 or private.trip_visible(t.visibility, v_pr.show_trips, v_deg))),
    'places', (
      select coalesce(jsonb_agg(jsonb_build_object('city', p.city_name, 'years', p.years, 'kind', p.kind)
             order by p.created_at), '[]')
      from public.user_places p where p.user_id = p_id),
    'schools', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'grad_year', us.grad_year, 'level', us.level)
             order by us.grad_year desc), '[]')
      from public.user_schools us join public.schools s on s.id = us.school_id where us.user_id = p_id)
  );

  if v_deg = 0 then return v_result; end if;

  -- "How you know each other" evidence and relationship state.
  v_result := v_result || jsonb_build_object(
    'shared_schools', (
      select coalesce(jsonb_agg(distinct s.name), '[]')
      from public.user_schools a join public.user_schools b on a.school_id = b.school_id
      join public.schools s on s.id = a.school_id
      where a.user_id = v_me and b.user_id = p_id),
    'shared_places', (
      select coalesce(jsonb_agg(distinct a.city_name), '[]')
      from public.user_places a join public.user_places b on lower(a.city_name) = lower(b.city_name)
      where a.user_id = v_me and b.user_id = p_id),
    'trip_overlaps', (
      select coalesce(jsonb_agg(jsonb_build_object('city', c.name,
               'from', greatest(a.starts_on, b.starts_on), 'to', least(a.ends_on, b.ends_on))), '[]')
      from public.trips a join public.trips b
        on a.city_id = b.city_id and a.starts_on <= b.ends_on and b.starts_on <= a.ends_on
      join public.cities c on c.id = a.city_id
      where a.user_id = v_me and b.user_id = p_id and a.ends_on >= current_date
        and private.trip_visible(b.visibility, v_pr.show_trips, v_deg)),
    'is_friend', private.is_friend(v_me, p_id),
    'friend_request', (
      select jsonb_build_object('id', r.id, 'status', r.status,
               'direction', case when r.from_id = v_me then 'sent' else 'received' end)
      from public.friend_requests r
      where r.status <> 'accepted'
        and ((r.from_id = v_me and r.to_id = p_id) or (r.from_id = p_id and r.to_id = v_me and r.status = 'pending'))
      order by r.created_at desc limit 1),
    'verified', private.pair_verification(v_me, p_id),
    'verification', (
      select jsonb_build_object(
               'id', v.id, 'method', v.method,
               'status', private.effective_status(v.status, v.expires_at),
               'role', case when v.requester_id = v_me then 'requester' else 'target' end,
               'mutual', coalesce(private.mini(v.mutual_id), jsonb_build_object('name', v.mutual_name)),
               'chat_id', v.chat_id, 'expires_at', v.expires_at)
      from public.verifications v
      where ((v.requester_id = v_me and v.target_id = p_id) or (v.requester_id = p_id and v.target_id = v_me))
        and v.status <> 'cancelled'
      order by v.created_at desc limit 1),
    'chat_id', (
      select ch.id from public.chats ch
      where ch.direct_key = least(v_me::text, p_id::text) || ':' || greatest(v_me::text, p_id::text))
  );

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Who can call what
-- ---------------------------------------------------------------------------
revoke execute on function private.live_point(uuid, text) from public, anon, authenticated;
revoke execute on function private.clear_live_location() from public, anon, authenticated;
revoke execute on function public.update_location(double precision, double precision, double precision) from public, anon;
grant execute on function public.update_location(double precision, double precision, double precision) to authenticated;
