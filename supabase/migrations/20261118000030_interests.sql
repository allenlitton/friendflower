-- ============================================================================
-- Interest tags (2026-11-18)
--   People add interest/hobby tags to their profile (Hiking, Coffee, Board
--   games...). Typing searches the tags that already exist, so everyone ends up
--   on the same "Rock climbing" instead of five spellings of it; a new name
--   becomes a new tag.
--   On someone else's profile, the tags you both have are marked as shared.
--
--   Both tables are private. The only ways in are the functions below:
--     search_interests(q)   tags to pick from (starter tags + ones people use)
--     my_interests()        your own tags
--     add_interest(name)    add a tag to your profile (creates it if new)
--     remove_interest(id)   take one off
--     person_interests(id)  someone's tags, each marked shared or not. Same
--                           visibility as person(): yourself, or someone in
--                           your circle (blocks already excluded there).
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.interests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  -- lower-case, single-spaced: "Rock  Climbing" and "rock climbing" are one tag.
  name_key text not null unique,
  is_starter boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table private.user_interests (
  user_id uuid not null references public.profiles (id) on delete cascade,
  interest_id uuid not null references private.interests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, interest_id)
);
create index user_interests_interest_idx on private.user_interests (interest_id);

revoke all on private.interests, private.user_interests from public, anon, authenticated;

create or replace function private.interest_key(p_name text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
$$;

-- Starter tags, so search has something to offer from day one.
insert into private.interests (name, name_key, is_starter)
select n, private.interest_key(n), true
from unnest(array[
  'Hiking', 'Coffee', 'Artisan products', 'Art', 'Swimming', 'Rock climbing',
  'Dungeons & Dragons', 'Board games',
  'Running', 'Yoga', 'Pilates', 'Cooking', 'Baking', 'Photography', 'Film',
  'Live music', 'Concerts', 'Reading', 'Book clubs', 'Travel', 'Surfing',
  'Cycling', 'Mountain biking', 'Skiing', 'Snowboarding', 'Tennis',
  'Pickleball', 'Golf', 'Gardening', 'Wine', 'Craft beer', 'Cocktails',
  'Gaming', 'Video games', 'Anime', 'Manga', 'Theatre', 'Musicals',
  'Dancing', 'Salsa', 'Volunteering', 'Pottery', 'Knitting', 'Crochet',
  'Sewing', 'Painting', 'Drawing', 'Writing', 'Poetry', 'Podcasts',
  'Comedy', 'Stand-up', 'Karaoke', 'Trivia nights', 'Museums', 'History',
  'Architecture', 'Interior design', 'Fashion', 'Thrifting', 'Vintage',
  'Camping', 'Backpacking', 'Climbing', 'Bouldering', 'Kayaking',
  'Sailing', 'Scuba diving', 'Fishing', 'Birdwatching', 'Nature',
  'Dogs', 'Cats', 'Basketball', 'Soccer', 'Football', 'Baseball',
  'Volleyball', 'Martial arts', 'Boxing', 'Weightlifting', 'CrossFit',
  'Meditation', 'Wellness', 'Tea', 'Brunch', 'Foodie', 'Vegan food',
  'Farmers markets', 'Tech', 'Startups', 'Coding', 'Science', 'Astronomy',
  'Languages', 'Chess', 'Puzzles', 'Jazz', 'Classical music', 'Hip hop',
  'Indie music', 'DJing', 'Playing music', 'Singing', 'Vinyl records',
  'Road trips', 'Beach days', 'Picnics', 'Festivals', 'Sports fans',
  'Formula 1', 'Skateboarding', 'Roller skating', 'Running clubs',
  'Marathons', 'Triathlon', 'Woodworking', 'DIY', 'Crafts', 'Calligraphy',
  'Journaling', 'Sustainability', 'Plants', 'Sci-fi', 'Fantasy', 'Horror films'
]) as n
on conflict (name_key) do nothing;

-- Tags to pick from, best match first. Only starter tags and tags someone
-- currently has are offered, so a tag nobody uses any more quietly disappears.
-- An empty query lists the most popular ones.
create or replace function public.search_interests(p_query text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  with q as (select private.interest_key(coalesce(p_query, '')) as k),
  hits as (
    select i.name, i.name_key, i.is_starter,
           (select count(*) from private.user_interests ui where ui.interest_id = i.id) as uses,
           i.id
    from private.interests i, q
    where position(q.k in i.name_key) > 0
      and not exists (select 1 from private.user_interests ui
                      where ui.user_id = private.me() and ui.interest_id = i.id)
  ),
  top as (
    select h.*, (h.name_key = q.k) as exact, starts_with(h.name_key, q.k) as prefix
    from hits h, q
    where h.is_starter or h.uses > 0
    order by exact desc, prefix desc, h.uses desc, h.name_key
    limit 12
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'uses', uses)
           order by exact desc, prefix desc, uses desc, name_key), '[]')
  from top;
$$;

create or replace function public.my_interests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by ui.created_at), '[]')
  from private.user_interests ui
  join private.interests i on i.id = ui.interest_id
  where ui.user_id = private.me();
$$;

-- Add a tag to your profile by name. Picks the existing tag when the name
-- matches one (ignoring case and spacing), otherwise creates it.
create or replace function public.add_interest(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key text := private.interest_key(coalesce(p_name, ''));
  v_tag private.interests;
begin
  if v_key = '' then raise exception 'Type an interest'; end if;
  if char_length(v_name) > 40 then raise exception 'Keep it under 40 characters'; end if;
  if (select count(*) from private.user_interests where user_id = v_me) >= 20 then
    raise exception 'You can add up to 20 interests';
  end if;

  insert into private.interests (name, name_key, created_by) values (v_name, v_key, v_me)
  on conflict (name_key) do nothing;
  select * into v_tag from private.interests where name_key = v_key;

  insert into private.user_interests (user_id, interest_id) values (v_me, v_tag.id)
  on conflict do nothing;
  return jsonb_build_object('id', v_tag.id, 'name', v_tag.name);
end $$;

create or replace function public.remove_interest(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.user_interests where user_id = private.me() and interest_id = p_id;
$$;

-- Someone's tags, shared ones first. Null when you can't see their profile.
create or replace function public.person_interests(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  if p_id <> v_me and not exists (select 1 from private.circle(v_me) c where c.uid = p_id) then
    return null;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'shared', t.shared)
             order by t.shared desc, ui.created_at), '[]')
    from private.user_interests ui
    join private.interests i on i.id = ui.interest_id
    cross join lateral (
      select p_id <> v_me and exists (
        select 1 from private.user_interests mine where mine.user_id = v_me and mine.interest_id = ui.interest_id
      ) as shared
    ) t
    where ui.user_id = p_id
  );
end $$;

revoke execute on function private.interest_key(text) from public, anon, authenticated;

revoke execute on function public.search_interests(text) from public, anon;
revoke execute on function public.my_interests() from public, anon;
revoke execute on function public.add_interest(text) from public, anon;
revoke execute on function public.remove_interest(uuid) from public, anon;
revoke execute on function public.person_interests(uuid) from public, anon;
grant execute on function public.search_interests(text) to authenticated;
grant execute on function public.my_interests() to authenticated;
grant execute on function public.add_interest(text) to authenticated;
grant execute on function public.remove_interest(uuid) to authenticated;
grant execute on function public.person_interests(uuid) to authenticated;
