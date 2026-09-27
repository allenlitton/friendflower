-- ============================================================================
-- Profiles say when someone has live distance on (2026-09-27)
--   Same as person() in 20260927000006_live_distance.sql, plus 'live_on': they
--   share live distance, even if they haven't opened the app in the last 30
--   minutes (so there's no position, and no distance, right now).
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

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
    'live_on', v_deg > 0 and v_pr.share_live_location and v_pr.show_distance,
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
