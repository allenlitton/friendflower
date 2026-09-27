-- ============================================================================
-- Performance fixes from the Supabase advisors (2026-09-27)
--   1. Row-level security checks look up the signed-in user once per query,
--      not once per row
--   2. Indexes on the foreign keys the app looks up by
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Wrap auth.uid() in a select so Postgres evaluates it once per query.
--    Same rules as before; only the way they are written changes.
-- ---------------------------------------------------------------------------
alter policy "own profile read" on public.profiles
  using (id = (select auth.uid()));
alter policy "own profile update" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "own places" on public.user_places
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "own schools" on public.user_schools
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "own trips" on public.trips
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "own flights" on public.trip_flights
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.trips t
                where t.id = trip_flights.trip_id and t.user_id = (select auth.uid()))
  );

alter policy "own regulars" on public.venue_regulars
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "own blocks" on public.blocks
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

alter policy "file report" on public.reports
  with check (reporter_id = (select auth.uid()));
alter policy "own reports" on public.reports
  using (reporter_id = (select auth.uid()));

alter policy "members read messages" on public.messages
  using (created_at <= private.member_left_at(chat_id, (select auth.uid())));

alter policy "read venues" on public.venues
  using (is_active and (created_by is null or created_by = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 2. Foreign-key indexes for lookups the app actually does
-- ---------------------------------------------------------------------------
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists profiles_home_city_id_idx on public.profiles (home_city_id);
create index if not exists profiles_home_neighbourhood_id_idx on public.profiles (home_neighbourhood_id);
create index if not exists venues_neighbourhood_id_idx on public.venues (neighbourhood_id);
create index if not exists venue_regulars_venue_id_idx on public.venue_regulars (venue_id);
