-- ============================================================================
-- Friend Flower — logic
--
-- Every function that returns information about OTHER people lives here and
-- runs as "security definer" (it can read all rows), so each one is written to
-- check the caller's relationship to that person first and only return what
-- the privacy rules allow. Nothing here ever returns phone numbers or emails.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

create or replace function private.me()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Please sign in' using errcode = '28000'; end if;
  return v;
end $$;

create or replace function private.miles(lat1 double precision, lng1 double precision,
                                         lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 3958.8 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

create or replace function private.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function private.display_name(p uuid)
returns text language sql stable security definer set search_path = '' as $$
  select trim(pr.first_name || case when pr.last_initial <> '' then ' ' || pr.last_initial || '.' else '' end)
  from public.profiles pr where pr.id = p;
$$;

create or replace function private.mini(p uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', pr.id, 'first_name', pr.first_name, 'name', private.display_name(pr.id),
    'avatar_url', pr.avatar_url)
  from public.profiles pr where pr.id = p;
$$;

create or replace function private.is_online(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(pr.show_online and pr.last_active_at > now() - interval '10 minutes', false)
  from public.profiles pr where pr.id = p;
$$;

create or replace function private.is_friend(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friend_requests r
    where r.status = 'accepted'
      and ((r.from_id = a and r.to_id = b) or (r.from_id = b and r.to_id = a))
  );
$$;

-- 1st-degree connections of a user (any source), minus blocks.
create or replace function private.first_degree(p uuid)
returns table (uid uuid) language sql stable security definer set search_path = '' as $$
  select distinct c.other_id
  from public.connections c
  where c.user_id = p and not private.is_blocked(p, c.other_id);
$$;

-- ---------------------------------------------------------------------------
-- The circle: everyone a viewer is allowed to see, and how they're connected.
--   degree 1: direct connection (mutual contacts or accepted friend)
--   degree 2: friend of a friend (vias = the mutual friends), or someone from
--             the same school within a year (via_kind = 'school')
-- Respects blocks and each person's "who can see me" setting.
-- ---------------------------------------------------------------------------
create or replace function private.circle(p_viewer uuid)
returns table (uid uuid, degree int, vias uuid[], via_kind text, via_school text)
language sql stable security definer set search_path = '' as $$
  with f1 as (
    select fd.uid from private.first_degree(p_viewer) fd
  ),
  f2 as (
    select c.other_id as uid, array_agg(distinct c.user_id) as vias
    from public.connections c
    join f1 on c.user_id = f1.uid
    where c.other_id <> p_viewer
      and c.other_id not in (select f1.uid from f1)
      and not private.is_blocked(p_viewer, c.other_id)
      and not private.is_blocked(c.user_id, c.other_id)
    group by c.other_id
  ),
  sch as (
    select distinct on (sb.user_id) sb.user_id as uid, s.name as school
    from public.user_schools sa
    join public.user_schools sb
      on sb.school_id = sa.school_id and sb.level = sa.level
     and abs(sb.grad_year - sa.grad_year) <= 1
    join public.schools s on s.id = sa.school_id
    where sa.user_id = p_viewer and sb.user_id <> p_viewer
      and sb.user_id not in (select f1.uid from f1)
      and sb.user_id not in (select f2.uid from f2)
      and not private.is_blocked(p_viewer, sb.user_id)
    order by sb.user_id, s.name
  ),
  everyone as (
    select f1.uid, 1 as degree, '{}'::uuid[] as vias, 'direct' as via_kind, null::text as via_school from f1
    union all
    select f2.uid, 2, f2.vias, 'friend', null from f2
    union all
    select sch.uid, 2, '{}'::uuid[], 'school', sch.school from sch
  )
  select e.uid, e.degree, e.vias, e.via_kind, e.via_school
  from everyone e
  join public.profiles pr on pr.id = e.uid
  where pr.onboarded_at is not null
    and (e.degree = 1 or pr.visibility = 'fof');
$$;

-- Can this viewer see this trip?
create or replace function private.trip_visible(p_trip_visibility text, p_show_trips boolean, p_degree int)
returns boolean language sql immutable set search_path = '' as $$
  select p_show_trips and case p_trip_visibility
    when 'nobody' then false
    when 'first'  then p_degree = 1
    else p_degree in (1, 2)
  end;
$$;

-- The best confirmed verification between two people, if any.
-- Mutual-friend confirmations (in app or by link) rank above self-reported ones.
create or replace function private.pair_verification(a uuid, b uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'method', v.method, 'confirmed_at', v.confirmed_at,
    'by', private.mini(v.confirmed_by),
    'mutual_name', coalesce(private.display_name(v.mutual_id), v.mutual_name))
  from public.verifications v
  where v.status = 'confirmed'
    and ((v.requester_id = a and v.target_id = b) or (v.requester_id = b and v.target_id = a))
  order by (v.method = 'self'), v.confirmed_at desc
  limit 1;
$$;

create or replace function private.effective_status(p_status text, p_expires timestamptz)
returns text language sql stable set search_path = '' as $$
  select case when p_status in ('pending_target', 'pending_mutual') and p_expires < now()
              then 'expired' else p_status end;
$$;

-- Where a person is on a given date, as far as a given viewer may know:
-- a visible trip covering that date, otherwise their declared home.
create or replace function private.whereabouts(p_user uuid, p_degree int, p_on date)
returns table (city_id text, neighbourhood_id text, presence text, trip_start date, trip_end date)
language sql stable security definer set search_path = '' as $$
  select x.city_id, x.neighbourhood_id, x.presence, x.trip_start, x.trip_end
  from (
    select t.city_id, t.neighbourhood_id, 'visiting' as presence,
           t.starts_on as trip_start, t.ends_on as trip_end, 0 as ord
    from public.trips t join public.profiles pr on pr.id = t.user_id
    where t.user_id = p_user and p_on between t.starts_on and t.ends_on
      and (p_degree = 0 or private.trip_visible(t.visibility, pr.show_trips, p_degree))
    union all
    select pr.home_city_id, pr.home_neighbourhood_id, 'lives', null::date, null::date, 1
    from public.profiles pr
    where pr.id = p_user and pr.home_city_id is not null
  ) x
  order by x.ord, x.trip_start desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- New users get a profile row automatically.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Match free-text lived-in cities to known cities where possible.
create or replace function private.match_place_city()
returns trigger language plpgsql set search_path = '' as $$
begin
  select c.id into new.city_id from public.cities c
  where lower(c.name) = lower(trim(new.city_name)) limit 1;
  new.city_name := trim(new.city_name);
  return new;
end $$;

create trigger user_places_match_city
  before insert or update of city_name on public.user_places
  for each row execute function private.match_place_city();

-- Users can't write the system-managed profile columns directly.
create or replace function private.protect_profile_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only the app's own functions (running as the database owner) may change these.
  if current_user in ('authenticated', 'anon') then
    new.invite_code    := old.invite_code;
    new.onboarded_at   := old.onboarded_at;
    new.last_active_at := old.last_active_at;
    new.created_at     := old.created_at;
  end if;
  return new;
end $$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function private.protect_profile_columns();

-- A neighbourhood must belong to the city it's declared with.
create or replace function private.check_neighbourhood()
returns trigger language plpgsql set search_path = '' as $$
declare v_city text; v_nb text;
begin
  if tg_table_name = 'profiles' then
    v_city := new.home_city_id; v_nb := new.home_neighbourhood_id;
  else
    v_city := new.city_id; v_nb := new.neighbourhood_id;
  end if;
  if v_nb is not null and not exists (
    select 1 from public.neighbourhoods n where n.id = v_nb and n.city_id = v_city
  ) then
    raise exception 'That neighbourhood is not in the selected city';
  end if;
  return new;
end $$;

create trigger profiles_check_nb before insert or update on public.profiles
  for each row execute function private.check_neighbourhood();
create trigger trips_check_nb before insert or update on public.trips
  for each row execute function private.check_neighbourhood();

-- ============================================================================
-- Public API (called from the app)
-- ============================================================================

-- Keep "online now" fresh. Called every couple of minutes while the app is open.
create or replace function public.touch_presence()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_active_at = now() where id = private.me();
$$;

create or replace function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_ok boolean;
begin
  select pr.first_name <> '' and pr.home_city_id is not null into v_ok
  from public.profiles pr where pr.id = v_me;
  if not coalesce(v_ok, false) then
    raise exception 'Add your first name and the city you live in first';
  end if;
  update public.profiles set onboarded_at = coalesce(onboarded_at, now()), last_active_at = now()
  where id = v_me;
end $$;

create or replace function public.add_school(p_name text, p_year int, p_level text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_school uuid; v_key text; v_id uuid;
begin
  v_key := lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
  if v_key = '' or char_length(v_key) > 120 then raise exception 'Enter a school name'; end if;
  insert into public.schools (name, name_key) values (trim(p_name), v_key)
  on conflict (name_key) do update set name_key = excluded.name_key
  returning id into v_school;
  insert into public.user_schools (user_id, school_id, grad_year, level)
  values (v_me, v_school, p_year, p_level)
  on conflict (user_id, school_id, level) do update set grad_year = excluded.grad_year
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Nearby: people in your circle who live in, or are visiting, a city.
-- You can browse your home city, or a city you've declared a trip to (for the
-- dates of that trip).
-- ---------------------------------------------------------------------------
create or replace function public.circle_in_city(p_city text, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, p_from, current_date);
  v_my_nb text;
  v_my_lat double precision; v_my_lng double precision;
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
      case when pr.show_distance and v_my_lat is not null and n.lat is not null
           then round(private.miles(v_my_lat, v_my_lng, n.lat, n.lng)::numeric, 1) end as distance_mi,
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
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.distance_mi nulls last, r.degree, r.first_name), '[]'::jsonb)
  into v_result
  from res r;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- One person's profile, filtered for the viewer. Returns null if the viewer
-- isn't allowed to see them.
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
  v_distance numeric; v_distance_kind text;
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
      if v_their_nb.id is not null and v_my_nb.id is not null then
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
-- World: your saved friends, city by city.
-- ---------------------------------------------------------------------------
create or replace function public.world()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_result jsonb;
begin
  with friends as (
    select case when r.from_id = v_me then r.to_id else r.from_id end as uid
    from public.friend_requests r
    where r.status = 'accepted' and (r.from_id = v_me or r.to_id = v_me)
  ),
  visible as (
    select f.uid, c.degree from friends f
    join private.circle(v_me) c on c.uid = f.uid
  ),
  spots as (
    -- where each friend is now
    select v.uid, w.city_id, w.presence, w.trip_start, w.trip_end, 0 as ord
    from visible v, lateral private.whereabouts(v.uid, v.degree, current_date) w
    union all
    -- and where they're headed in the next 120 days
    select v.uid, t.city_id, 'upcoming', t.starts_on, t.ends_on, 1
    from visible v
    join public.trips t on t.user_id = v.uid
    join public.profiles pr on pr.id = v.uid
    where t.starts_on > current_date and t.starts_on <= current_date + 120
      and private.trip_visible(t.visibility, pr.show_trips, v.degree)
  ),
  people as (
    select s.city_id,
      jsonb_agg(private.mini(s.uid) || jsonb_build_object(
        'online', private.is_online(s.uid), 'presence', s.presence,
        'from', s.trip_start, 'until', s.trip_end) order by s.ord, s.trip_start nulls first) as people,
      count(*) filter (where s.presence = 'lives') as based,
      count(*) filter (where s.presence = 'visiting') as visiting,
      count(*) filter (where s.presence = 'upcoming') as upcoming
    from spots s group by s.city_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'city_id', c.id, 'city', c.name, 'short', c.short_name, 'is_launched', c.is_launched,
      'people', p.people, 'based', p.based, 'visiting', p.visiting, 'upcoming', p.upcoming,
      'my_trip', (select jsonb_build_object('id', t.id, 'starts_on', t.starts_on, 'ends_on', t.ends_on)
                  from public.trips t where t.user_id = v_me and t.city_id = c.id and t.ends_on >= current_date
                  order by t.starts_on limit 1),
      'is_home', c.id = (select pr.home_city_id from public.profiles pr where pr.id = v_me))
    order by (c.id = (select pr.home_city_id from public.profiles pr where pr.id = v_me)) desc,
             jsonb_array_length(p.people) desc), '[]')
  into v_result
  from people p join public.cities c on c.id = p.city_id;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Flights: people in your circle on the same flight, same day.
-- ---------------------------------------------------------------------------
create or replace function public.flight_matches()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select private.me() as id),
  c as (select * from private.circle((select id from me)))
  select coalesce(jsonb_agg(jsonb_build_object(
      'flight_id', mine.id, 'flight_no', mine.flight_no, 'flight_date', mine.flight_date,
      'person', private.mini(c.uid) || jsonb_build_object(
        'degree', c.degree,
        'via', (select private.display_name(c.vias[1]))))), '[]')
  from public.trip_flights mine
  join public.trip_flights theirs
    on theirs.flight_no = mine.flight_no and theirs.flight_date = mine.flight_date
   and theirs.user_id <> mine.user_id
  join c on c.uid = theirs.user_id
  join public.trips t on t.id = theirs.trip_id
  join public.profiles pr on pr.id = theirs.user_id
  where mine.user_id = (select id from me)
    and mine.flight_date >= current_date
    and private.trip_visible(t.visibility, pr.show_trips, c.degree);
$$;

-- ---------------------------------------------------------------------------
-- Friends ("Add friend")
-- ---------------------------------------------------------------------------
create or replace function private.make_friends(a uuid, b uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.connections (user_id, other_id, source)
  values (a, b, 'friend'), (b, a, 'friend')
  on conflict do nothing;
$$;

create or replace function public.add_friend(p_other uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_reverse public.friend_requests;
  v_existing public.friend_requests;
begin
  if p_other = v_me then raise exception 'That''s you'; end if;
  if private.is_blocked(v_me, p_other) then raise exception 'Not available'; end if;

  select * into v_reverse from public.friend_requests
  where from_id = p_other and to_id = v_me;
  if v_reverse.status = 'accepted' then return 'accepted'; end if;
  if v_reverse.status = 'pending' then
    update public.friend_requests set status = 'accepted', responded_at = now() where id = v_reverse.id;
    perform private.make_friends(v_me, p_other);
    return 'accepted';
  end if;

  -- You can add someone in your circle, someone you're chatting with, or
  -- someone whose number/email is in your uploaded contacts.
  if not exists (select 1 from private.circle(v_me) c where c.uid = p_other)
     and not exists (
       select 1 from public.chat_members a join public.chat_members b on a.chat_id = b.chat_id
       where a.user_id = v_me and b.user_id = p_other)
     and not exists (
       select 1 from private.contact_hashes ch join private.identity_hashes ih on ih.hash = ch.hash
       where ch.owner_id = v_me and ih.user_id = p_other)
  then
    raise exception 'You can only add people in your circle';
  end if;

  select * into v_existing from public.friend_requests where from_id = v_me and to_id = p_other;
  if v_existing.id is not null then
    -- Declined requests stay quietly declined; don't reveal that to the sender.
    return case when v_existing.status = 'accepted' then 'accepted' else 'pending' end;
  end if;

  insert into public.friend_requests (from_id, to_id) values (v_me, p_other);
  return 'pending';
end $$;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_req public.friend_requests;
begin
  select * into v_req from public.friend_requests where id = p_id and to_id = v_me and status = 'pending';
  if v_req.id is null then raise exception 'Request not found'; end if;
  update public.friend_requests
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_id;
  if p_accept then perform private.make_friends(v_me, v_req.from_id); end if;
end $$;

create or replace function public.remove_friend(p_other uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  delete from public.friend_requests
   where (from_id = v_me and to_id = p_other) or (from_id = p_other and to_id = v_me);
  delete from public.connections
   where source = 'friend'
     and ((user_id = v_me and other_id = p_other) or (user_id = p_other and other_id = v_me));
end $$;

-- Signing up through someone's invite link makes you friends with them.
create or replace function public.redeem_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_inviter uuid;
begin
  select id into v_inviter from public.profiles where invite_code = p_code;
  if v_inviter is null or v_inviter = v_me or private.is_blocked(v_me, v_inviter) then return null; end if;
  insert into public.friend_requests (from_id, to_id, status, responded_at)
  values (v_inviter, v_me, 'accepted', now())
  on conflict (from_id, to_id) do update set status = 'accepted', responded_at = now();
  perform private.make_friends(v_me, v_inviter);
  return v_inviter;
end $$;

create or replace function public.invite_preview(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('first_name', pr.first_name, 'avatar_url', pr.avatar_url)
  from public.profiles pr where pr.invite_code = p_code and pr.onboarded_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- Inbox: things waiting on you.
-- ---------------------------------------------------------------------------
create or replace function public.inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  return jsonb_build_object(
    'friend_requests', (
      select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'from', private.mini(r.from_id))
             order by r.created_at desc), '[]')
      from public.friend_requests r
      where r.to_id = v_me and r.status = 'pending' and not private.is_blocked(v_me, r.from_id)),
    'verifications', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id, 'method', v.method, 'status', v.status,
               'role', case when v.target_id = v_me then 'target' else 'mutual' end,
               'requester', private.mini(v.requester_id),
               'target', private.mini(v.target_id),
               'mutual', private.mini(v.mutual_id),
               'chat_id', v.chat_id,
               'expires_at', v.expires_at) order by v.created_at desc), '[]')
      from public.verifications v
      where v.expires_at > now()
        and ((v.target_id = v_me and v.status = 'pending_target')
          or (v.mutual_id = v_me and v.status = 'pending_mutual'))
        and not private.is_blocked(v_me, v.requester_id)),
    'contact_suggestions', (
      -- People whose number/email is in YOUR contacts but who aren't connected
      -- to you yet. (Never the reverse — that would reveal their address book.)
      select coalesce(jsonb_agg(private.mini(s.uid)), '[]')
      from (
        select distinct ih.user_id as uid
        from private.contact_hashes ch
        join private.identity_hashes ih on ih.hash = ch.hash
        join public.profiles pr on pr.id = ih.user_id and pr.onboarded_at is not null
        where ch.owner_id = v_me and ih.user_id <> v_me
          and not exists (select 1 from public.connections c where c.user_id = v_me and c.other_id = ih.user_id)
          and not exists (select 1 from public.friend_requests r where r.from_id = v_me and r.to_id = ih.user_id)
          and not private.is_blocked(v_me, ih.user_id)
        limit 50
      ) s)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Chats
-- ---------------------------------------------------------------------------
create or replace function public.open_direct_chat(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_key text; v_chat uuid;
begin
  if p_other = v_me then raise exception 'That''s you'; end if;
  if private.is_blocked(v_me, p_other) then raise exception 'Not available'; end if;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  select id into v_chat from public.chats where direct_key = v_key;
  if v_chat is not null then return v_chat; end if;

  if not exists (select 1 from private.circle(v_me) c where c.uid = p_other) then
    raise exception 'You can message people in your circle';
  end if;

  insert into public.chats (kind, direct_key) values ('direct', v_key) returning id into v_chat;
  insert into public.chat_members (chat_id, user_id) values (v_chat, v_me), (v_chat, p_other);
  return v_chat;
end $$;

create or replace function public.send_message(p_chat uuid, p_body text, p_venue uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_id bigint; v_kind text;
begin
  if not private.is_active_member(p_chat, v_me) then raise exception 'You''re not in this chat'; end if;
  if exists (
    select 1 from public.chat_members m
    where m.chat_id = p_chat and m.user_id <> v_me and m.left_at is null
      and private.is_blocked(v_me, m.user_id)
  ) then
    raise exception 'Not available';
  end if;
  v_kind := case when p_venue is not null then 'venue' else 'text' end;
  insert into public.messages (chat_id, sender_id, kind, body, venue_id)
  values (p_chat, v_me, v_kind, trim(p_body), p_venue) returning id into v_id;
  update public.chats set last_message_at = now() where id = p_chat;
  update public.chat_members set last_read_at = now() where chat_id = p_chat and user_id = v_me;
  return v_id;
end $$;

create or replace function private.system_message(p_chat uuid, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.messages (chat_id, sender_id, kind, body) values (p_chat, null, 'system', p_body);
  update public.chats set last_message_at = now() where id = p_chat;
$$;

create or replace function public.mark_read(p_chat uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_members set last_read_at = now()
  where chat_id = p_chat and user_id = private.me();
$$;

create or replace function public.leave_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if (select kind from public.chats where id = p_chat) <> 'pod' then
    raise exception 'Only verification chats can be left';
  end if;
  if not private.is_active_member(p_chat, v_me) then return; end if;
  perform private.system_message(p_chat, private.display_name(v_me) || ' left the chat.');
  update public.chat_members set left_at = now() where chat_id = p_chat and user_id = v_me;
end $$;

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
               order by msg.created_at desc limit 1),
      'unread', exists (select 1 from public.messages msg
                        where msg.chat_id = ch.id and msg.created_at > me.last_read_at
                          and msg.created_at <= coalesce(me.left_at, 'infinity')
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
  ) x;
  return v_result;
end $$;

create or replace function public.chat_detail(p_chat uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_chat public.chats; v_other uuid; v_c record;
begin
  if not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = v_me) then
    return null;
  end if;
  select * into v_chat from public.chats where id = p_chat;
  select * into v_c from private.circle(v_me) c where false;  -- give v_c its shape

  if v_chat.kind = 'direct' then
    select user_id into v_other from public.chat_members where chat_id = p_chat and user_id <> v_me;
    if private.is_blocked(v_me, v_other) then return null; end if;
    select * into v_c from private.circle(v_me) c where c.uid = v_other;
  end if;

  return jsonb_build_object(
    'id', v_chat.id, 'kind', v_chat.kind,
    'can_post', private.is_active_member(p_chat, v_me),
    'members', (select jsonb_agg(private.mini(m.user_id) || jsonb_build_object(
                  'left', m.left_at is not null, 'is_me', m.user_id = v_me))
                from public.chat_members m where m.chat_id = p_chat),
    'other', case when v_other is not null then private.mini(v_other) || jsonb_build_object(
        'degree', v_c.degree,
        'online', private.is_online(v_other),
        'via', (select private.display_name(v_c.vias[1])),
        'via_kind', v_c.via_kind, 'via_school', v_c.via_school,
        'is_friend', private.is_friend(v_me, v_other),
        'friend_request', (
          select jsonb_build_object('id', r.id, 'status', r.status,
                   'direction', case when r.from_id = v_me then 'sent' else 'received' end)
          from public.friend_requests r
          where r.status <> 'accepted'
            and ((r.from_id = v_me and r.to_id = v_other) or (r.from_id = v_other and r.to_id = v_me and r.status = 'pending'))
          order by r.created_at desc limit 1),
        'verified', private.pair_verification(v_me, v_other) is not null) end,
    'verification', (
      select jsonb_build_object(
        'id', v.id, 'status', private.effective_status(v.status, v.expires_at),
        'requester', private.mini(v.requester_id), 'target', private.mini(v.target_id),
        'mutual', private.mini(v.mutual_id),
        'i_am_mutual', v.mutual_id = v_me, 'expires_at', v.expires_at)
      from public.verifications v where v.chat_id = p_chat limit 1)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Mutual-friend verification
-- ---------------------------------------------------------------------------
create or replace function public.request_verification(
  p_target uuid, p_method text, p_mutual uuid default null, p_mutual_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_c record;
  v_token text; v_id uuid;
begin
  select * into v_c from private.circle(v_me) c where c.uid = p_target;
  if v_c.degree is distinct from 2 then
    raise exception 'Verification is for friends of friends';
  end if;
  if private.pair_verification(v_me, p_target) is not null then
    raise exception 'You two are already verified';
  end if;
  if exists (select 1 from public.verifications v
             where ((v.requester_id = v_me and v.target_id = p_target) or (v.requester_id = p_target and v.target_id = v_me))
               and v.status in ('pending_target', 'pending_mutual') and v.expires_at > now()) then
    raise exception 'There''s already a verification in progress';
  end if;
  if p_mutual is not null and not (p_mutual = any (v_c.vias)) then
    raise exception 'Pick someone you both know';
  end if;

  if p_method = 'in_app' then
    if p_mutual is null then raise exception 'Pick the mutual friend to ask'; end if;
    insert into public.verifications (requester_id, target_id, mutual_id, method, status)
    values (v_me, p_target, p_mutual, 'in_app', 'pending_target') returning id into v_id;

  elsif p_method = 'link' then
    if p_mutual is null and coalesce(trim(p_mutual_name), '') = '' then
      raise exception 'Who are you asking?';
    end if;
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.verifications (requester_id, target_id, mutual_id, mutual_name, method, status, token_hash)
    values (v_me, p_target, p_mutual, nullif(trim(p_mutual_name), ''), 'link', 'pending_mutual',
            encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
    returning id into v_id;

  elsif p_method = 'self' then
    if p_mutual is null and coalesce(trim(p_mutual_name), '') = '' then
      raise exception 'Who did you check with?';
    end if;
    insert into public.verifications (requester_id, target_id, mutual_id, mutual_name, method, status,
                                      confirmed_by, confirmed_at, responded_at)
    values (v_me, p_target, p_mutual, nullif(trim(p_mutual_name), ''), 'self', 'confirmed',
            v_me, now(), now())
    returning id into v_id;
  else
    raise exception 'Unknown method';
  end if;

  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- The other friend-of-friend says yes/no to opening the 3-person chat.
create or replace function public.respond_verification(p_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v public.verifications; v_chat uuid;
begin
  select * into v from public.verifications where id = p_id and target_id = v_me;
  if v.id is null or private.effective_status(v.status, v.expires_at) <> 'pending_target' then
    raise exception 'This request is no longer open';
  end if;

  if not p_accept then
    update public.verifications set status = 'declined', responded_at = now() where id = p_id;
    return null;
  end if;

  insert into public.chats (kind) values ('pod') returning id into v_chat;
  insert into public.chat_members (chat_id, user_id)
  values (v_chat, v.requester_id), (v_chat, v.target_id), (v_chat, v.mutual_id);
  perform private.system_message(v_chat,
    private.display_name(v.requester_id) || ' asked ' || private.display_name(v.mutual_id) ||
    ' to confirm how you all know each other. Nobody here can see anyone''s contacts.');
  update public.verifications
     set status = 'pending_mutual', chat_id = v_chat, responded_at = now(),
         expires_at = greatest(expires_at, now() + interval '7 days')
   where id = p_id;
  return v_chat;
end $$;

-- The mutual friend confirms (with an optional intro) or says they don't know them.
create or replace function public.confirm_verification(p_id uuid, p_confirm boolean, p_intro text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v public.verifications;
begin
  select * into v from public.verifications where id = p_id and mutual_id = v_me and method = 'in_app';
  if v.id is null or private.effective_status(v.status, v.expires_at) <> 'pending_mutual' then
    raise exception 'This request is no longer open';
  end if;

  if p_confirm then
    update public.verifications set status = 'confirmed', confirmed_by = v_me, confirmed_at = now()
    where id = p_id;
    perform private.system_message(v.chat_id,
      private.display_name(v_me) || ' confirmed they know you both. You''re verified.');
    if coalesce(trim(p_intro), '') <> '' then
      insert into public.messages (chat_id, sender_id, kind, body)
      values (v.chat_id, v_me, 'text', left(trim(p_intro), 2000));
      update public.chats set last_message_at = now() where id = v.chat_id;
    end if;
  else
    update public.verifications set status = 'declined', responded_at = now() where id = p_id;
    perform private.system_message(v.chat_id,
      private.display_name(v_me) || ' couldn''t confirm this connection.');
  end if;
end $$;

create or replace function public.cancel_verification(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.verifications set status = 'cancelled'
  where id = p_id and requester_id = private.me() and status in ('pending_target', 'pending_mutual');
$$;

-- Link method: what the person who opens the link sees.
create or replace function public.verification_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v public.verifications;
begin
  select * into v from public.verifications
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and method = 'link';
  if v.id is null then return null; end if;
  return jsonb_build_object(
    'id', v.id,
    'status', private.effective_status(v.status, v.expires_at),
    'requester', private.mini(v.requester_id),
    'target', private.mini(v.target_id),
    'mutual_name', coalesce(private.display_name(v.mutual_id), v.mutual_name),
    'can_confirm', v_me not in (v.requester_id, v.target_id)
                   and (v.mutual_id is null or v.mutual_id = v_me),
    'confirmed_by', private.mini(v.confirmed_by));
end $$;

create or replace function public.confirm_verification_link(p_token text, p_confirm boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v public.verifications;
begin
  select * into v from public.verifications
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and method = 'link';
  if v.id is null or private.effective_status(v.status, v.expires_at) <> 'pending_mutual' then
    raise exception 'This link has expired or was already used';
  end if;
  if v_me in (v.requester_id, v.target_id) then
    raise exception 'This link is for the mutual friend to open';
  end if;
  if v.mutual_id is not null and v.mutual_id <> v_me then
    raise exception 'This link was sent to someone else';
  end if;
  update public.verifications
     set status = case when p_confirm then 'confirmed' else 'declined' end,
         confirmed_by = case when p_confirm then v_me end,
         confirmed_at = case when p_confirm then now() end,
         responded_at = now(),
         mutual_id = coalesce(mutual_id, v_me)
   where id = v.id;
end $$;

-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_other uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if p_other = v_me then return; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_me, p_other) on conflict do nothing;
  delete from public.friend_requests
   where (from_id = v_me and to_id = p_other) or (from_id = p_other and to_id = v_me);
  delete from public.connections
   where source = 'friend'
     and ((user_id = v_me and other_id = p_other) or (user_id = p_other and other_id = v_me));
  update public.verifications set status = 'cancelled'
   where status in ('pending_target', 'pending_mutual')
     and ((requester_id = v_me and target_id = p_other) or (requester_id = p_other and target_id = v_me));
end $$;

create or replace function public.report_user(p_other uuid, p_reason text, p_details text default null, p_block boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  insert into public.reports (reporter_id, reported_id, reason, details)
  values (v_me, p_other, p_reason, nullif(trim(p_details), ''));
  if p_block then perform public.block_user(p_other); end if;
end $$;

create or replace function public.my_blocks()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.mini(b.blocked_id) order by b.created_at desc), '[]')
  from public.blocks b where b.blocker_id = private.me();
$$;

-- ---------------------------------------------------------------------------
-- Places to meet
-- ---------------------------------------------------------------------------
create or replace function public.venues_in(p_city text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_lat double precision; v_lng double precision; v_result jsonb;
begin
  -- Walking distance from your declared neighbourhood (trip there, else home).
  select n.lat, n.lng into v_lat, v_lng
  from public.neighbourhoods n
  where n.id = coalesce(
    (select t.neighbourhood_id from public.trips t
      where t.user_id = v_me and t.city_id = p_city and t.ends_on >= current_date
      order by t.starts_on limit 1),
    (select pr.home_neighbourhood_id from public.profiles pr where pr.id = v_me and pr.home_city_id = p_city));

  with c as (select * from private.circle(v_me))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ve.id, 'name', ve.name, 'kind', ve.kind, 'note', ve.note,
      'neighbourhood', n.name,
      'walk_min', case when v_lat is not null
                       then round(private.miles(v_lat, v_lng, ve.lat, ve.lng) * 20)::int end,
      'i_go', exists (select 1 from public.venue_regulars r where r.venue_id = ve.id and r.user_id = v_me),
      'regulars', (select coalesce(jsonb_agg(private.mini(r.user_id)), '[]')
                   from public.venue_regulars r join c on c.uid = r.user_id
                   where r.venue_id = ve.id))
    order by ve.sort, ve.name), '[]')
  into v_result
  from public.venues ve left join public.neighbourhoods n on n.id = ve.neighbourhood_id
  where ve.city_id = p_city and ve.is_active;
  return v_result;
end $$;

-- ============================================================================
-- Server-only functions (the app's backend calls these with the service key).
-- Raw contact data never reaches the database: the server normalises and
-- hashes it with a secret pepper, then hands over only the hashes.
-- ============================================================================

create or replace function private.refresh_contact_edges(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.connections
   where source = 'contacts' and (user_id = p_user or other_id = p_user);

  insert into public.connections (user_id, other_id, source)
  select p_user, o.uid, 'contacts' from (
    select distinct ih.user_id as uid
    from private.contact_hashes ch
    join private.identity_hashes ih on ih.hash = ch.hash
    where ch.owner_id = p_user and ih.user_id <> p_user
  ) o
  where exists (  -- ...and they have you too
    select 1 from private.contact_hashes ch2
    join private.identity_hashes ih2 on ih2.hash = ch2.hash
    where ch2.owner_id = o.uid and ih2.user_id = p_user
  )
  on conflict do nothing;

  insert into public.connections (user_id, other_id, source)
  select c.other_id, c.user_id, 'contacts' from public.connections c
  where c.user_id = p_user and c.source = 'contacts'
  on conflict do nothing;
end $$;

-- Register the caller's own hashed phone/email. Returns hashes that someone
-- else already claimed (so the app can say "that number is already in use").
create or replace function public.srv_set_identity_hashes(p_user uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conflicts jsonb;
begin
  select coalesce(jsonb_agg(i->>'hash'), '[]') into v_conflicts
  from jsonb_array_elements(p_items) i
  join private.identity_hashes ih on ih.hash = i->>'hash' and ih.user_id <> p_user;

  delete from private.identity_hashes
   where user_id = p_user and kind in (select distinct i->>'kind' from jsonb_array_elements(p_items) i);

  insert into private.identity_hashes (user_id, kind, hash)
  select p_user, i->>'kind', i->>'hash' from jsonb_array_elements(p_items) i
  where not exists (select 1 from private.identity_hashes ih where ih.hash = i->>'hash')
  on conflict do nothing;

  -- Anyone who already had this person in their contacts may now be a match.
  perform private.refresh_contact_edges(p_user);
  return v_conflicts;
end $$;

create or replace function public.srv_add_contact_hashes(p_user uuid, p_hashes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.connections where user_id = p_user and source = 'contacts';
  insert into private.contact_hashes (owner_id, hash)
  select p_user, h from unnest(p_hashes) h where h ~ '^[0-9a-f]{64}$'
  on conflict do nothing;
  perform private.refresh_contact_edges(p_user);
  select count(*) into v_after from public.connections where user_id = p_user and source = 'contacts';
  return jsonb_build_object(
    'new_matches', v_after - v_before,
    'on_app', (select count(distinct ih.user_id) from private.contact_hashes ch
               join private.identity_hashes ih on ih.hash = ch.hash
               where ch.owner_id = p_user and ih.user_id <> p_user));
end $$;

-- You can wipe your uploaded contacts at any time.
create or replace function public.delete_my_contacts()
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  delete from private.contact_hashes where owner_id = v_me;
  perform private.refresh_contact_edges(v_me);
end $$;

create or replace function public.my_contact_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'uploaded', (select count(*) from private.contact_hashes where owner_id = private.me()),
    'matches', (select count(*) from public.connections where user_id = private.me() and source = 'contacts'),
    'has_phone', exists (select 1 from private.identity_hashes where user_id = private.me() and kind = 'phone'));
$$;

-- ============================================================================
-- Permissions: nothing is callable by signed-out visitors, and the srv_*
-- functions are callable only by the server.
-- ============================================================================
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function private.is_active_member(uuid, uuid) to authenticated;
grant execute on function private.member_left_at(uuid, uuid) to authenticated;

revoke execute on function public.srv_set_identity_hashes(uuid, jsonb) from authenticated;
revoke execute on function public.srv_add_contact_hashes(uuid, text[]) from authenticated;
grant execute on function public.srv_set_identity_hashes(uuid, jsonb) to service_role;
grant execute on function public.srv_add_contact_hashes(uuid, text[]) to service_role;

-- The invite landing page is shown before sign-in.
grant execute on function public.invite_preview(text) to anon;

-- Signed-out visitors can't read any table, and nobody reads `private` directly.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from public, anon, authenticated;
