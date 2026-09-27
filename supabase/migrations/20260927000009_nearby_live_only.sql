-- ============================================================================
-- Nearby only shows people with live distance on (2026-09-27)
--   Same as circle_in_city in 20260927000006_live_distance.sql, plus a filter:
--   people who haven't turned on live distance (share_live_location, with
--   show_distance) are left out. They still appear on World and their profiles.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

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
    where pr.share_live_location and pr.show_distance
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.distance_mi nulls last, r.degree, r.first_name), '[]'::jsonb)
  into v_result
  from res r;

  return v_result;
end $$;
