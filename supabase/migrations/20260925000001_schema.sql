-- ============================================================================
-- Friend Flower — core schema
--
-- PRIVACY MODEL (read this before changing anything):
--   * Other people's profile data is NEVER read straight from these tables.
--     Row-Level Security only lets you read your OWN rows. Everything you can
--     see about someone else comes from the functions in the next migration,
--     which check your connection to that person first.
--   * Contact lists (phone numbers / emails) are hashed by the server before
--     they reach the database, and live in the `private` schema, which the
--     public API cannot reach at all.
--   * No exact location is ever stored. A person's position is their declared
--     city plus an optional declared neighbourhood.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

-- A city is a first-class row. Launching a new city = flipping is_launched and
-- adding its neighbourhoods and venues. No code changes needed.
create table public.cities (
  id          text primary key,                 -- slug, e.g. 'san-francisco'
  name        text not null,
  short_name  text not null,                    -- 'SF', 'NYC'
  country     text not null,
  lat         double precision not null,        -- city centre, used for
  lng         double precision not null,        -- city-to-city distance only
  timezone    text,
  is_launched boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Declared neighbourhoods. Matching is metro-wide; neighbourhoods only exist
-- so we can show a coarse "~1.5 mi away" between two people in the same city.
create table public.neighbourhoods (
  id      text primary key,                     -- e.g. 'sf-mission'
  city_id text not null references public.cities(id) on delete cascade,
  name    text not null,
  lat     double precision not null,
  lng     double precision not null
);
create index on public.neighbourhoods (city_id);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  first_name            text not null default '' check (char_length(first_name) <= 40),
  last_initial          text not null default '' check (char_length(last_initial) <= 2),
  avatar_url            text,
  bio                   text not null default '' check (char_length(bio) <= 500),
  hometown              text check (char_length(hometown) <= 60),
  birth_year            int  check (birth_year between 1900 and 2100),
  home_city_id          text references public.cities(id),
  home_neighbourhood_id text references public.neighbourhoods(id),
  languages             text[] not null default '{}',
  spots                 text[] not null default '{}',   -- "where they'd take you"
  instagram             text check (char_length(instagram) <= 60),
  facebook              text check (char_length(facebook) <= 80),
  -- 'first' = only 1st-degree connections can see me; 'fof' = friends of friends too
  visibility            text not null default 'fof' check (visibility in ('first', 'fof')),
  show_online           boolean not null default true,
  show_distance         boolean not null default true,
  show_trips            boolean not null default true,
  last_active_at        timestamptz,
  invite_code           text not null unique
                          default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  onboarded_at          timestamptz,
  created_at            timestamptz not null default now()
);

-- Cities you've lived in (history). Free text so people can add anywhere;
-- city_id is filled in automatically when the name matches a known city.
create table public.user_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  city_name  text not null check (char_length(city_name) between 1 and 80),
  city_id    text references public.cities(id),
  years      text check (char_length(years) <= 40),
  kind       text not null default 'lived' check (kind in ('lived', 'grew_up')),
  created_at timestamptz not null default now()
);
create index on public.user_places (user_id);

create table public.schools (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  name_key text not null unique            -- lower-cased, trimmed; used to match
);

create table public.user_schools (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  grad_year int  not null check (grad_year between 1940 and 2100),
  level     text not null check (level in ('high_school', 'undergrad', 'grad')),
  unique (user_id, school_id, level)
);
create index on public.user_schools (school_id, grad_year);

-- ---------------------------------------------------------------------------
-- Trips (declared, never tracked)
-- ---------------------------------------------------------------------------

create table public.trips (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  city_id          text not null references public.cities(id),
  neighbourhood_id text references public.neighbourhoods(id),   -- optional "staying in"
  starts_on        date not null,
  ends_on          date not null,
  -- who can see this trip: 1st degree only, friends of friends, or nobody
  visibility       text not null default 'fof' check (visibility in ('first', 'fof', 'nobody')),
  created_at       timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 366)
);
create index on public.trips (city_id, starts_on, ends_on);
create index on public.trips (user_id);

-- Optional flight numbers on a trip, used to show "on your flight".
-- Seat numbers are never collected.
create table public.trip_flights (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  direction   text not null check (direction in ('in', 'out')),
  flight_no   text not null check (flight_no ~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$'),
  flight_date date not null,
  unique (trip_id, direction)
);
create index on public.trip_flights (flight_no, flight_date);

-- ---------------------------------------------------------------------------
-- The friend graph
-- ---------------------------------------------------------------------------

-- Private: your own hashed phone/email, so other people's contact lists can
-- find you. Hashes are computed server-side with a secret pepper.
create table private.identity_hashes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind    text not null check (kind in ('phone', 'email')),
  hash    text not null unique,
  primary key (user_id, kind, hash)
);

-- Private: hashes of the phone numbers/emails in your uploaded contacts.
-- Raw contacts are never stored anywhere.
create table private.contact_hashes (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  hash     text not null,
  primary key (owner_id, hash)
);
create index on private.contact_hashes (hash);

-- 1st-degree edges. Stored in BOTH directions so lookups are simple.
--   'contacts' = each person has the other in their contacts (mutual match)
--   'friend'   = an accepted "Add friend" (or a redeemed invite link)
create table public.connections (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  other_id   uuid not null references public.profiles(id) on delete cascade,
  source     text not null check (source in ('contacts', 'friend')),
  created_at timestamptz not null default now(),
  primary key (user_id, other_id, source),
  check (user_id <> other_id)
);
create index on public.connections (other_id);

-- "Add friend". An accepted request = a saved friend who shows on your World page.
create table public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  from_id      uuid not null references public.profiles(id) on delete cascade,
  to_id        uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (from_id, to_id),
  check (from_id <> to_id)
);
create index on public.friend_requests (to_id, status);

-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index on public.blocks (blocked_id);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('fake_profile', 'impersonation', 'harassment', 'spam', 'other')),
  details     text check (char_length(details) <= 1000),
  status      text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Chats and mutual-friend verification
-- ---------------------------------------------------------------------------

create table public.chats (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('direct', 'pod')),
  direct_key      text unique,          -- 'smallerUuid:largerUuid' for direct chats
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id      uuid not null references public.chats(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index on public.chat_members (user_id);

create table public.messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  sender_id  uuid references public.profiles(id) on delete set null,  -- null = system
  kind       text not null default 'text' check (kind in ('text', 'system', 'venue')),
  body       text not null check (char_length(body) between 1 and 2000),
  venue_id   uuid,
  created_at timestamptz not null default now()
);
create index on public.messages (chat_id, created_at);

-- A request for a mutual friend to confirm that requester and target are
-- genuinely connected through them.
--   method 'in_app' : target accepts -> 3-person pod chat opens -> mutual taps confirm
--   method 'link'   : requester texts the mutual a one-tap link (works even if
--                     the mutual isn't on the app yet — they join to confirm)
--   method 'self'   : requester says "I checked with them off the app".
--                     Shown with a weaker, clearly-labelled badge.
-- Pending requests expire after 7 days (worked out at read time, no cron job).
create table public.verifications (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  mutual_id    uuid references public.profiles(id) on delete set null,
  mutual_name  text check (char_length(mutual_name) <= 60),  -- for someone not on the app
  method       text not null check (method in ('in_app', 'link', 'self')),
  status       text not null check (status in ('pending_target', 'pending_mutual', 'confirmed', 'declined', 'cancelled')),
  token_hash   text unique,
  chat_id      uuid references public.chats(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  responded_at timestamptz,
  confirmed_at timestamptz,
  check (requester_id <> target_id)
);
create index on public.verifications (requester_id);
create index on public.verifications (target_id);
create index on public.verifications (mutual_id);

-- ---------------------------------------------------------------------------
-- Places to meet (hand-curated, read-only for users)
-- ---------------------------------------------------------------------------

create table public.venues (
  id               uuid primary key default gen_random_uuid(),
  city_id          text not null references public.cities(id) on delete cascade,
  neighbourhood_id text references public.neighbourhoods(id),
  name             text not null,
  kind             text not null check (kind in ('coffee', 'restaurant', 'bar', 'outdoors', 'movement')),
  note             text not null default '',
  lat              double precision not null,
  lng              double precision not null,
  is_active        boolean not null default true,
  sort             int not null default 100
);
create index on public.venues (city_id);

-- "I go here" — lets venues show which of your circle vouch for them.
create table public.venue_regulars (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  primary key (user_id, venue_id)
);

alter table public.messages
  add constraint messages_venue_fk foreign key (venue_id) references public.venues(id) on delete set null;

-- ============================================================================
-- Row-Level Security
-- Rule of thumb: you can read and write your own rows; everything about other
-- people goes through the privacy-checking functions.
-- ============================================================================

alter table public.cities          enable row level security;
alter table public.neighbourhoods  enable row level security;
alter table public.profiles        enable row level security;
alter table public.user_places     enable row level security;
alter table public.schools         enable row level security;
alter table public.user_schools    enable row level security;
alter table public.trips           enable row level security;
alter table public.trip_flights    enable row level security;
alter table public.connections     enable row level security;
alter table public.friend_requests enable row level security;
alter table public.blocks          enable row level security;
alter table public.reports         enable row level security;
alter table public.chats           enable row level security;
alter table public.chat_members    enable row level security;
alter table public.messages        enable row level security;
alter table public.verifications   enable row level security;
alter table public.venues          enable row level security;
alter table public.venue_regulars  enable row level security;

-- Reference data: readable by any signed-in user.
create policy "read cities"         on public.cities         for select to authenticated using (true);
create policy "read neighbourhoods" on public.neighbourhoods for select to authenticated using (true);
create policy "read schools"        on public.schools        for select to authenticated using (true);
create policy "read venues"         on public.venues         for select to authenticated using (is_active);

-- Your own profile.
create policy "own profile read"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Your own history, schools, trips, flights, venue saves.
create policy "own places"   on public.user_places    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own schools"  on public.user_schools   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own trips"    on public.trips          for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own flights"  on public.trip_flights   for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
create policy "own regulars" on public.venue_regulars for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Blocks: you manage your own list.
create policy "own blocks" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- Reports: you can file one, and see the ones you filed.
create policy "file report" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "own reports" on public.reports for select to authenticated using (reporter_id = auth.uid());

-- connections, friend_requests, chats, chat_members, verifications: no direct
-- policies — all access goes through functions. That's deliberate.

-- Messages: members can read a chat's history (up to the moment they left),
-- and post while they're still in it. Realtime uses this same policy.
create or replace function private.is_active_member(p_chat uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_members m
    where m.chat_id = p_chat and m.user_id = p_user and m.left_at is null
  );
$$;

create or replace function private.member_left_at(p_chat uuid, p_user uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select coalesce(m.left_at, 'infinity'::timestamptz)
  from public.chat_members m where m.chat_id = p_chat and m.user_id = p_user;
$$;

create policy "members read messages" on public.messages for select to authenticated
  using (created_at <= private.member_left_at(chat_id, auth.uid()));

grant usage on schema private to authenticated;
grant execute on function private.is_active_member(uuid, uuid) to authenticated;
grant execute on function private.member_left_at(uuid, uuid) to authenticated;

-- Posting goes through send_message() (see functions) so blocks are enforced.

-- ---------------------------------------------------------------------------
-- Storage: avatars. Anyone signed in can view (paths are random); you can only
-- write inside your own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Realtime: stream new messages to chat members.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
