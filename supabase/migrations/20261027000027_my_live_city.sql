-- ============================================================================
-- Nearby follows where you actually are (2026-10-27)
--   With Live distance on, Nearby (and Places) now open on the city your
--   latest live position is in, rather than on a planned trip that happens
--   to start today. A New York trip starting today no longer moves you to
--   New York while you're still in San Francisco.
--   Only positions from the last 30 minutes count, and nothing is returned
--   when Live distance is off. Only the city id leaves the database, never
--   the position.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create or replace function public.my_live_city()
returns text language sql stable security definer set search_path = '' as $$
  select private.city_at(l.user_id, l.lat, l.lng)
  from private.live_locations l
  join public.profiles pr on pr.id = l.user_id
  where l.user_id = private.me()
    and pr.share_live_location and pr.show_distance
    and l.updated_at > now() - interval '30 minutes';
$$;

revoke execute on function public.my_live_city() from public, anon;
grant execute on function public.my_live_city() to authenticated;
