-- ============================================================================
-- Peninsula neighbourhoods for the San Francisco metro, and a units setting
-- (2026-09-27)
-- ============================================================================

insert into public.neighbourhoods (id, city_id, name, lat, lng) values
  ('sf-brisbane',       'san-francisco', 'Brisbane',            37.6808, -122.3999),
  ('sf-south-sf',       'san-francisco', 'South San Francisco', 37.6547, -122.4077),
  ('sf-burlingame',     'san-francisco', 'Burlingame',          37.5841, -122.3661),
  ('sf-hillsborough',   'san-francisco', 'Hillsborough',        37.5741, -122.3794)
on conflict (id) do nothing;

-- Distances show in miles/feet or kilometres/metres; set from You -> Settings.
alter table public.profiles
  add column if not exists units text not null default 'imperial'
  check (units in ('imperial', 'metric'));
