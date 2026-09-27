-- ============================================================================
-- Two more San Francisco neighbourhoods (2026-09-27)
-- ============================================================================

insert into public.neighbourhoods (id, city_id, name, lat, lng) values
  ('sf-buena-vista-terrace', 'san-francisco', 'Buena Vista Terrace', 37.7665, -122.4380),
  ('sf-duboce-triangle',     'san-francisco', 'Duboce Triangle',     37.7686, -122.4318)
on conflict (id) do nothing;
