-- ============================================================================
-- Places in more cities (2026-10-21)
--   Places to meet can now open in a city without its live map. has_places
--   puts a city on the Places tab; is_launched still decides where Nearby's
--   live map runs (New York and San Francisco for now, while we test there).
--   Opens Places in every city friends live in: Singapore, Hong Kong,
--   Melbourne and Tokyo, each with neighbourhoods (so people can add places)
--   and a few starter picks.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

alter table public.cities add column if not exists has_places boolean not null default false;

update public.cities set has_places = true
where is_launched or id in ('singapore', 'hong-kong', 'melbourne', 'tokyo');

-- ---------------------------------------------------------------------------
-- Neighbourhoods
-- ---------------------------------------------------------------------------
insert into public.neighbourhoods (id, city_id, name, lat, lng) values
  ('sg-tiong-bahru',    'singapore', 'Tiong Bahru',     1.2847, 103.8270),
  ('sg-tanjong-pagar',  'singapore', 'Tanjong Pagar',   1.2764, 103.8460),
  ('sg-chinatown',      'singapore', 'Chinatown',       1.2836, 103.8443),
  ('sg-kampong-glam',   'singapore', 'Kampong Glam',    1.3022, 103.8590),
  ('sg-joo-chiat',      'singapore', 'Joo Chiat',       1.3127, 103.9010),
  ('sg-dempsey',        'singapore', 'Dempsey Hill',    1.3050, 103.8100),
  ('sg-orchard',        'singapore', 'Orchard',         1.3048, 103.8318),
  ('sg-holland-village','singapore', 'Holland Village', 1.3110, 103.7960),
  ('sg-marina-bay',     'singapore', 'Marina Bay',      1.2830, 103.8600),

  ('hk-central',        'hong-kong', 'Central',         22.2820, 114.1580),
  ('hk-soho',           'hong-kong', 'SoHo',            22.2830, 114.1520),
  ('hk-sheung-wan',     'hong-kong', 'Sheung Wan',      22.2860, 114.1500),
  ('hk-sai-ying-pun',   'hong-kong', 'Sai Ying Pun',    22.2860, 114.1430),
  ('hk-kennedy-town',   'hong-kong', 'Kennedy Town',    22.2810, 114.1280),
  ('hk-wan-chai',       'hong-kong', 'Wan Chai',        22.2770, 114.1730),
  ('hk-causeway-bay',   'hong-kong', 'Causeway Bay',    22.2800, 114.1840),
  ('hk-tsim-sha-tsui',  'hong-kong', 'Tsim Sha Tsui',   22.2980, 114.1720),

  ('mel-cbd',           'melbourne', 'CBD',             -37.8136, 144.9631),
  ('mel-fitzroy',       'melbourne', 'Fitzroy',         -37.7980, 144.9780),
  ('mel-collingwood',   'melbourne', 'Collingwood',     -37.8020, 144.9880),
  ('mel-carlton',       'melbourne', 'Carlton',         -37.8000, 144.9670),
  ('mel-brunswick',     'melbourne', 'Brunswick',       -37.7670, 144.9600),
  ('mel-richmond',      'melbourne', 'Richmond',        -37.8230, 144.9980),
  ('mel-south-yarra',   'melbourne', 'South Yarra',     -37.8380, 144.9930),
  ('mel-st-kilda',      'melbourne', 'St Kilda',        -37.8670, 144.9810),

  ('tk-shibuya',        'tokyo',     'Shibuya',         35.6595, 139.7005),
  ('tk-harajuku',       'tokyo',     'Harajuku',        35.6702, 139.7027),
  ('tk-shinjuku',       'tokyo',     'Shinjuku',        35.6900, 139.7000),
  ('tk-shimokitazawa',  'tokyo',     'Shimokitazawa',   35.6616, 139.6680),
  ('tk-nakameguro',     'tokyo',     'Nakameguro',      35.6440, 139.6990),
  ('tk-daikanyama',     'tokyo',     'Daikanyama',      35.6486, 139.7031),
  ('tk-ebisu',          'tokyo',     'Ebisu',           35.6467, 139.7101),
  ('tk-asakusa',        'tokyo',     'Asakusa',         35.7148, 139.7967),
  ('tk-kiyosumi',       'tokyo',     'Kiyosumi-Shirakawa', 35.6810, 139.7990)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Starter picks. Friends add the rest.
-- ---------------------------------------------------------------------------
insert into public.venues (city_id, neighbourhood_id, name, kind, note, lat, lng, sort) values
  ('singapore', 'sg-tiong-bahru',  'Tiong Bahru Bakery',        'coffee',     'Croissants and a flat white in the old estate.', 1.2846, 103.8326, 10),
  ('singapore', 'sg-chinatown',    'Maxwell Food Centre',       'restaurant', 'Hawker lunch. Queue for the chicken rice.',      1.2803, 103.8448, 20),
  ('singapore', 'sg-kampong-glam', 'Atlas',                     'bar',        'Art deco gin palace. Dress up a little.',         1.2995, 103.8570, 30),
  ('singapore', 'sg-dempsey',      'Singapore Botanic Gardens', 'outdoors',   'Early walk before the heat.',                    1.3138, 103.8159, 40),

  ('hong-kong', 'hk-central',      'Lan Fong Yuen',             'restaurant', 'Milk tea and pork chop buns, cha chaan teng classic.', 22.2834, 114.1546, 10),
  ('hong-kong', 'hk-soho',         'The Old Man',               'bar',        'Tiny room, serious cocktails.',                   22.2833, 114.1523, 20),
  ('hong-kong', 'hk-central',      'Tai Kwun',                  'outdoors',   'Old police compound. Meet in the courtyard.',     22.2814, 114.1543, 30),
  ('hong-kong', 'hk-kennedy-town', 'Kennedy Town waterfront',   'outdoors',   'Harbour sunset, then dinner nearby.',             22.2840, 114.1270, 40),

  ('melbourne', 'mel-cbd',         'Patricia Coffee Brewers',   'coffee',     'Standing room only. Laneway flat white.',         -37.8133, 144.9600, 10),
  ('melbourne', 'mel-collingwood', 'Proud Mary',                'coffee',     'Big brunch, bigger coffee.',                      -37.8000, 144.9910, 20),
  ('melbourne', 'mel-cbd',         'Tipo 00',                   'restaurant', 'Pasta worth booking ahead for.',                  -37.8125, 144.9617, 30),
  ('melbourne', 'mel-south-yarra', 'Royal Botanic Gardens',     'outdoors',   'Loop the Ornamental Lake.',                       -37.8304, 144.9796, 40),
  ('melbourne', 'mel-st-kilda',    'St Kilda Pier',             'outdoors',   'Walk out at dusk for the penguins.',              -37.8640, 144.9670, 50),

  ('tokyo',     'tk-shibuya',      'Fuglen Tokyo',              'coffee',     'Norwegian coffee by day, cocktails by night.',    35.6680, 139.6925, 10),
  ('tokyo',     'tk-kiyosumi',     'Blue Bottle Kiyosumi-Shirakawa', 'coffee', 'The first one in Japan. Walk the garden after.', 35.6800, 139.8010, 20),
  ('tokyo',     'tk-ebisu',        'Afuri Ebisu',               'restaurant', 'Yuzu shio ramen, quick and bright.',              35.6480, 139.7090, 30),
  ('tokyo',     'tk-shinjuku',     'Golden Gai',                'bar',        'Pick a tiny bar with an open seat.',              35.6940, 139.7045, 40),
  ('tokyo',     'tk-harajuku',     'Yoyogi Park',               'outdoors',   'Weekend picnics and buskers.',                    35.6717, 139.6949, 50),
  ('tokyo',     'tk-nakameguro',   'Meguro River',              'outdoors',   'Walk the river. Best in cherry blossom season.',  35.6440, 139.6985, 60);
