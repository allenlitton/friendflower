# Adding a city

Cities are rows in the database, not code. A city has two switches:

- `has_places` puts it on the Places tab so people there can add places to meet.
- `is_launched` also turns on the live map (Nearby). Only New York and San
  Francisco have this for now.

To open one, open your Supabase
project → **SQL Editor** → **New query**, paste the template below, edit it, and
press **Run**.

About 120 world cities already exist (they're used for trips and past homes),
so most of the time you only need to switch the city on and add its
neighbourhoods and venues. People can only add a place once a city has at
least one neighbourhood.

```sql
-- 1. Open Places in the city (or add it if it isn't there yet).
--    Set is_launched to true as well to turn on the live map there.
insert into public.cities (id, name, short_name, country, lat, lng, timezone, has_places)
values ('london', 'London', 'LDN', 'United Kingdom', 51.5074, -0.1278, 'Europe/London', true)
on conflict (id) do update set has_places = true;

-- 2. Neighbourhoods (only used for rough "~1.5 mi" distances; matching is city-wide).
--    Get the centre point by right-clicking the area in Google Maps.
insert into public.neighbourhoods (id, city_id, name, lat, lng) values
  ('ldn-hackney',   'london', 'Hackney',   51.5450, -0.0553),
  ('ldn-peckham',   'london', 'Peckham',   51.4740, -0.0691),
  ('ldn-islington', 'london', 'Islington', 51.5362, -0.1033);

-- 3. Places to meet. kind is one of: coffee, restaurant, bar, outdoors, movement, museum
insert into public.venues (city_id, neighbourhood_id, name, kind, note, lat, lng, sort) values
  ('london', 'ldn-hackney', 'Example Coffee', 'coffee', 'Short note in your voice.', 51.5450, -0.0553, 10);
```

To hide a venue without deleting it: `update public.venues set is_active = false where name = '…';`

## Who's asking for a city that isn't live yet?

People can add trips to any city. This shows which un-launched cities are most wanted:

```sql
select c.name, count(distinct t.user_id) as travellers
from public.trips t join public.cities c on c.id = t.city_id
where not c.is_launched and t.ends_on >= current_date
group by c.name order by travellers desc;
```

## Friends in a city without Places yet

```sql
select c.name, count(*) as members
from public.profiles p join public.cities c on c.id = p.home_city_id
where not c.has_places
group by c.name order by members desc;
```
