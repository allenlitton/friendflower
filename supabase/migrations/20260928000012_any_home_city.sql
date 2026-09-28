-- ============================================================================
-- Live anywhere (2026-09-28)
--   People can say they live in any city in the world, not just the short
--   is_home_option list. The app looks cities up in the Open-Meteo geocoder
--   (GeoNames data) and adds a city row the first time someone picks it.
--   New cities aren't launched: no live map there, but friends still see you
--   in that city on their World page.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

alter table public.cities add column if not exists geoname_id bigint unique;
alter table public.cities add column if not exists region text;  -- state / province, to tell apart same-named cities

-- Adds a geocoded city (or returns the existing one). Only the server calls
-- this, after fetching the city from the geocoder itself, so people can't
-- invent cities or coordinates.
create or replace function public.srv_add_city(
  p_geoname_id bigint, p_name text, p_region text, p_country text,
  p_lat double precision, p_lng double precision, p_timezone text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id text;
  v_base text;
  v_short text;
begin
  select c.id into v_id from public.cities c where c.geoname_id = p_geoname_id;
  if found then return v_id; end if;

  v_base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then v_base := 'city'; end if;
  v_id := v_base;
  if exists (select 1 from public.cities c where c.id = v_id) then
    v_id := v_base || '-' || trim(both '-' from regexp_replace(lower(coalesce(p_region, p_country)), '[^a-z0-9]+', '-', 'g'));
  end if;
  if v_id = v_base || '-' or exists (select 1 from public.cities c where c.id = v_id) then
    v_id := v_base || '-' || p_geoname_id;
  end if;

  v_short := upper(left(regexp_replace(p_name, '[^A-Za-z]', '', 'g'), 3));
  if v_short = '' then v_short := left(p_name, 3); end if;

  insert into public.cities (id, name, short_name, country, region, lat, lng, timezone, geoname_id, is_launched)
  values (v_id, p_name, v_short, p_country, p_region, p_lat, p_lng, p_timezone, p_geoname_id, false)
  on conflict (geoname_id) do nothing;

  select c.id into v_id from public.cities c where c.geoname_id = p_geoname_id;
  return v_id;
end $$;

revoke execute on function public.srv_add_city(bigint, text, text, text, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.srv_add_city(bigint, text, text, text, double precision, double precision, text) to service_role;
