-- ============================================================================
-- Launch Bali (2026-11-27): live map (Nearby), live distances and Places.
--   Bali already existed as a home option; this switches it on and adds its
--   neighbourhoods and a starter list of places to meet.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

update public.cities set is_launched = true, is_home_option = true where id = 'bali';

-- Neighbourhoods (rough centre points; only used for "~1.5 km" distances).
insert into public.neighbourhoods (id, city_id, name, lat, lng) values
  ('bali-canggu',     'bali', 'Canggu',     -8.6478, 115.1385),
  ('bali-berawa',     'bali', 'Berawa',     -8.6595, 115.1486),
  ('bali-pererenan',  'bali', 'Pererenan',  -8.6430, 115.1235),
  ('bali-kerobokan',  'bali', 'Kerobokan',  -8.6560, 115.1720),
  ('bali-seminyak',   'bali', 'Seminyak',   -8.6913, 115.1683),
  ('bali-legian',     'bali', 'Legian',     -8.7040, 115.1700),
  ('bali-kuta',       'bali', 'Kuta',       -8.7180, 115.1690),
  ('bali-denpasar',   'bali', 'Denpasar',   -8.6705, 115.2126),
  ('bali-sanur',      'bali', 'Sanur',      -8.6930, 115.2620),
  ('bali-jimbaran',   'bali', 'Jimbaran',   -8.7900, 115.1600),
  ('bali-nusa-dua',   'bali', 'Nusa Dua',   -8.8000, 115.2300),
  ('bali-bingin',     'bali', 'Bingin',     -8.8058, 115.1137),
  ('bali-uluwatu',    'bali', 'Uluwatu',    -8.8291, 115.0849),
  ('bali-ubud',       'bali', 'Ubud',       -8.5069, 115.2625)
on conflict (id) do nothing;

-- Places to meet. Starter list -- review before launch (hours, still open, etc.)
insert into public.venues (city_id, neighbourhood_id, name, kind, note, lat, lng, sort)
select v.* from (values
  ('bali', 'bali-canggu',   'Crate Cafe',              'coffee',     'Busy, cheerful, everyone ends up here eventually.', -8.6497, 115.1381, 10),
  ('bali', 'bali-berawa',   'Milk & Madu',             'coffee',     'Easy brunch spot for a first hello.',              -8.6571, 115.1462, 20),
  ('bali', 'bali-seminyak', 'Revolver Espresso',       'coffee',     'Tucked down a laneway. Great flat whites.',        -8.6847, 115.1640, 30),
  ('bali', 'bali-ubud',     'Seniman Coffee Studio',   'coffee',     'Serious coffee, relaxed room.',                    -8.5066, 115.2611, 40),
  ('bali', 'bali-ubud',     'Clear Cafe',              'restaurant', 'Shoes off, long menu, easy to linger.',            -8.5077, 115.2633, 50),
  ('bali', 'bali-seminyak', 'Motel Mexicola',          'restaurant', 'Loud, colourful, good for a group.',               -8.6925, 115.1585, 60),
  ('bali', 'bali-canggu',   'The Lawn',                'bar',        'Beanbags on the grass at sunset.',                 -8.6595, 115.1300, 70),
  ('bali', 'bali-canggu',   'La Brisa',                'bar',        'Driftwood beach bar at Echo Beach.',               -8.6537, 115.1258, 80),
  ('bali', 'bali-uluwatu',  'Single Fin',              'bar',        'Cliff-top view over the surf. Go for sunset.',     -8.8150, 115.0880, 90),
  ('bali', 'bali-canggu',   'Batu Bolong Beach',       'outdoors',   'The no-commitment option. Late afternoon.',        -8.6597, 115.1305, 100),
  ('bali', 'bali-ubud',     'Campuhan Ridge Walk',     'outdoors',   'Go early before it gets hot.',                     -8.5040, 115.2550, 110),
  ('bali', 'bali-sanur',    'Sanur Beach Path',        'outdoors',   'Flat seaside walk, coffee stops all along.',       -8.6900, 115.2640, 120),
  ('bali', 'bali-ubud',     'The Yoga Barn',           'movement',   'Drop-in classes most of the day.',                 -8.5130, 115.2640, 130),
  ('bali', 'bali-ubud',     'Museum Puri Lukisan',     'museum',     'Balinese painting in a quiet garden.',             -8.5065, 115.2603, 140)
) as v(city_id, neighbourhood_id, name, kind, note, lat, lng, sort)
where not exists (
  select 1 from public.venues x where x.city_id = v.city_id and x.name = v.name and x.created_by is null
);
