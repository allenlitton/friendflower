-- ============================================================================
-- Concierge watch (2026-09-29)
--   Tells you when someone you've saved as a friend is in the same city as you
--   (or will be), because one of you is travelling. No AI: it is worked out
--   from the trips and home cities people already declared.
--
--   - Worked out when you look, never stored, so it always follows the live
--     privacy rules (trip visibility, show_trips, blocks, circle degree) and
--     drops away the moment a trip is edited, hidden or deleted.
--   - Two people who both live in the same city are not an alert; that is just
--     "nearby". One of you has to be visiting.
--   - concierge_seen remembers which overlaps you have already looked at, so
--     the World tab dot only lights for something new.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table public.concierge_seen (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  friend_id    uuid not null references public.profiles(id) on delete cascade,
  city_id      text not null references public.cities(id) on delete cascade,
  overlap_from date not null,
  seen_to      date not null,
  seen_at      timestamptz not null default now(),
  primary key (user_id, friend_id, city_id, overlap_from)
);
alter table public.concierge_seen enable row level security;
create policy "own seen" on public.concierge_seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.concierge_seen from anon;

-- ---------------------------------------------------------------------------
-- 1. Stretches of days when you and a saved friend are in the same city and at
--    least one of you is visiting. Looks 30 days back (so a long stay keeps
--    one steady start) and 120 days ahead; only stretches not yet over.
-- ---------------------------------------------------------------------------
create or replace function private.concierge_overlaps(p_me uuid)
returns table (friend_id uuid, city_id text, overlap_from date, overlap_to date,
               friend_presence text, my_presence text)
language sql stable security definer set search_path = '' as $$
  with friends as (
    select case when r.from_id = p_me then r.to_id else r.from_id end as uid
    from public.friend_requests r
    where r.status = 'accepted' and (r.from_id = p_me or r.to_id = p_me)
  ),
  visible as (
    select f.uid, c.degree from friends f
    join private.circle(p_me) c on c.uid = f.uid
  ),
  days as (
    select d::date as d from generate_series(current_date - 30, current_date + 120, interval '1 day') d
  ),
  mine as (
    select dd.d, w.city_id, w.presence
    from days dd, lateral private.whereabouts(p_me, 0, dd.d) w
  ),
  -- Only look closely at friends who could possibly line up with you.
  cand as (
    select v.uid, v.degree from visible v
    where exists (select 1 from public.trips t join public.profiles pr on pr.id = t.user_id
                  where t.user_id = v.uid
                    and t.ends_on >= current_date - 30 and t.starts_on <= current_date + 120
                    and private.trip_visible(t.visibility, pr.show_trips, v.degree))
       or exists (select 1 from mine m join public.profiles pr on pr.id = v.uid
                  where m.presence = 'visiting' and m.city_id = pr.home_city_id)
  ),
  together as (
    select c.uid, m.d, m.city_id, w.presence as fp, m.presence as mp
    from cand c
    cross join mine m
    cross join lateral private.whereabouts(c.uid, c.degree, m.d) w
    where w.city_id = m.city_id and not (w.presence = 'lives' and m.presence = 'lives')
  ),
  grouped as (
    select t.*, t.d - (row_number() over (partition by t.uid, t.city_id, t.fp, t.mp order by t.d))::int as grp
    from together t
  )
  select g.uid, g.city_id, min(g.d), max(g.d), g.fp, g.mp
  from grouped g
  group by g.uid, g.city_id, g.fp, g.mp, g.grp
  having max(g.d) >= current_date;
$$;

-- ---------------------------------------------------------------------------
-- 2. What the World tab shows.
--    kind: visiting_you (they come to where you live), you_visiting (you go to
--    where they live), both_away (you are both travelling to the same place).
-- ---------------------------------------------------------------------------
create or replace function public.concierge_watch()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select private.me() as id),
  o as (select * from private.concierge_overlaps((select id from me)))
  select coalesce(jsonb_agg(jsonb_build_object(
      'friend', private.mini(o.friend_id),
      'city_id', o.city_id, 'city', c.name, 'short', c.short_name,
      'from', o.overlap_from, 'to', o.overlap_to,
      'kind', case when o.friend_presence = 'visiting' and o.my_presence = 'lives' then 'visiting_you'
                   when o.friend_presence = 'lives' and o.my_presence = 'visiting' then 'you_visiting'
                   else 'both_away' end,
      'is_new', not exists (
        select 1 from public.concierge_seen s
        where s.user_id = (select id from me) and s.friend_id = o.friend_id and s.city_id = o.city_id
          and s.overlap_from <= o.overlap_to and s.seen_to >= o.overlap_from - 1))
    order by o.overlap_from, o.friend_id), '[]'::jsonb)
  from o join public.cities c on c.id = o.city_id;
$$;

create or replace function public.concierge_unseen_count()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from jsonb_array_elements(public.concierge_watch()) e
  where (e ->> 'is_new')::boolean;
$$;

-- ---------------------------------------------------------------------------
-- 3. "I've looked": remember today's overlaps so the dot goes away. A seen
--    overlap that is still running (or gets longer) stays seen.
-- ---------------------------------------------------------------------------
create or replace function public.concierge_mark_seen()
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  insert into public.concierge_seen (user_id, friend_id, city_id, overlap_from, seen_to)
  select v_me, o.friend_id, o.city_id, o.overlap_from, o.overlap_to
  from private.concierge_overlaps(v_me) o
  where not exists (
    select 1 from public.concierge_seen s
    where s.user_id = v_me and s.friend_id = o.friend_id and s.city_id = o.city_id
      and s.overlap_from <= o.overlap_to and s.seen_to >= o.overlap_from - 1)
  on conflict do nothing;

  update public.concierge_seen s
  set seen_to = greatest(s.seen_to, o.overlap_to), seen_at = now()
  from private.concierge_overlaps(v_me) o
  where s.user_id = v_me and s.friend_id = o.friend_id and s.city_id = o.city_id
    and s.overlap_from <= o.overlap_to and s.seen_to >= o.overlap_from - 1;

  delete from public.concierge_seen where user_id = v_me and seen_to < current_date - 30;
end $$;

revoke execute on function private.concierge_overlaps(uuid) from public, anon, authenticated;
revoke execute on function public.concierge_watch() from public, anon;
revoke execute on function public.concierge_unseen_count() from public, anon;
revoke execute on function public.concierge_mark_seen() from public, anon;
grant execute on function public.concierge_watch() to authenticated;
grant execute on function public.concierge_unseen_count() to authenticated;
grant execute on function public.concierge_mark_seen() to authenticated;
