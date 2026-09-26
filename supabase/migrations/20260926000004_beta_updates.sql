-- ============================================================================
-- Beta updates (2026-09-26)
--   1. Home-city choices at sign-up
--   2. Places people add themselves, shared with their circle
--   3. Find a friend by email or phone number
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cities people can pick as "currently living in"
-- ---------------------------------------------------------------------------
alter table public.cities add column if not exists is_home_option boolean not null default false;

insert into public.cities (id, name, short_name, country, lat, lng, timezone, is_launched)
values ('sacramento', 'Sacramento', 'SAC', 'United States', 38.5816, -121.4944, 'America/Los_Angeles', false)
on conflict (id) do nothing;

update public.cities set is_home_option = true
where id in ('san-francisco', 'new-york', 'sacramento', 'los-angeles', 'bali', 'sydney', 'melbourne', 'singapore');

-- The live map (Nearby) only runs in launched cities (is_launched); the app
-- shows a friendly message for everywhere else.

-- ---------------------------------------------------------------------------
-- 2. Places added by people (visible to them and their circle)
-- ---------------------------------------------------------------------------
alter table public.venues add column if not exists created_by uuid references public.profiles(id) on delete cascade;
alter table public.venues add column if not exists created_at timestamptz not null default now();
alter table public.venues add constraint venues_name_len check (char_length(name) between 1 and 80);
alter table public.venues add constraint venues_note_len check (char_length(note) <= 280);

-- Direct reads only see the curated list plus your own additions; your
-- circle's additions come through venues_in(), which checks the connection.
drop policy if exists "read venues" on public.venues;
create policy "read venues" on public.venues for select to authenticated
  using (is_active and (created_by is null or created_by = auth.uid()));

create or replace function public.add_place(
  p_city text, p_neighbourhood text, p_name text, p_kind text, p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_nb public.neighbourhoods; v_id uuid;
begin
  select * into v_nb from public.neighbourhoods where id = p_neighbourhood and city_id = p_city;
  if v_nb.id is null then raise exception 'Pick the neighbourhood it''s in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Add the place''s name'; end if;
  if (select count(*) from public.venues where created_by = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot of places for one day - try again tomorrow';
  end if;
  insert into public.venues (city_id, neighbourhood_id, name, kind, note, lat, lng, sort, created_by)
  values (p_city, v_nb.id, trim(p_name), p_kind, coalesce(trim(p_note), ''), v_nb.lat, v_nb.lng, 500, v_me)
  returning id into v_id;
  insert into public.venue_regulars (user_id, venue_id) values (v_me, v_id) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.remove_place(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.venues where id = p_id and created_by = private.me();
$$;

create or replace function public.venues_in(p_city text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_lat double precision; v_lng double precision; v_result jsonb;
begin
  -- Walking distance from your declared neighbourhood (trip there, else home).
  select n.lat, n.lng into v_lat, v_lng
  from public.neighbourhoods n
  where n.id = coalesce(
    (select t.neighbourhood_id from public.trips t
      where t.user_id = v_me and t.city_id = p_city and t.ends_on >= current_date
      order by t.starts_on limit 1),
    (select pr.home_neighbourhood_id from public.profiles pr where pr.id = v_me and pr.home_city_id = p_city));

  with c as (select * from private.circle(v_me))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ve.id, 'name', ve.name, 'kind', ve.kind, 'note', ve.note,
      'neighbourhood', n.name,
      'walk_min', case when v_lat is not null
                       then round(private.miles(v_lat, v_lng, ve.lat, ve.lng) * 20)::int end,
      'added_by', case when ve.created_by is not null then private.mini(ve.created_by) end,
      'mine', ve.created_by = v_me,
      'i_go', exists (select 1 from public.venue_regulars r where r.venue_id = ve.id and r.user_id = v_me),
      'regulars', (select coalesce(jsonb_agg(private.mini(r.user_id)), '[]')
                   from public.venue_regulars r join c on c.uid = r.user_id
                   where r.venue_id = ve.id))
    order by (ve.created_by is not null), ve.sort, ve.name), '[]')
  into v_result
  from public.venues ve left join public.neighbourhoods n on n.id = ve.neighbourhood_id
  where ve.city_id = p_city and ve.is_active
    and (ve.created_by is null or ve.created_by = v_me
         or exists (select 1 from c where c.uid = ve.created_by));
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Find a friend by email or phone.
-- The server hashes what you typed; this looks the hash up. Finding someone
-- also saves them as one of your contacts (so if they have you too, you're
-- connected straight away). Limited to 30 searches a day to stop fishing.
-- ---------------------------------------------------------------------------
create table if not exists private.lookup_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists lookup_log_user_at on private.lookup_log (user_id, at);
alter table private.lookup_log enable row level security;

create or replace function public.srv_find_person(p_user uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_other uuid;
begin
  if (select count(*) from private.lookup_log where user_id = p_user and at > now() - interval '1 day') >= 30 then
    return jsonb_build_object('status', 'limit');
  end if;
  insert into private.lookup_log (user_id) values (p_user);

  select ih.user_id into v_other
  from private.identity_hashes ih join public.profiles pr on pr.id = ih.user_id
  where ih.hash = p_hash and pr.onboarded_at is not null;

  if v_other = p_user then return jsonb_build_object('status', 'self'); end if;
  if v_other is null or private.is_blocked(p_user, v_other) then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into private.contact_hashes (owner_id, hash) values (p_user, p_hash) on conflict do nothing;
  perform private.refresh_contact_edges(p_user);

  return jsonb_build_object(
    'status', 'found',
    'person', private.mini(v_other),
    'is_friend', private.is_friend(p_user, v_other),
    'request', (select jsonb_build_object('id', r.id, 'status', r.status,
                  'direction', case when r.from_id = p_user then 'sent' else 'received' end)
                from public.friend_requests r
                where r.status <> 'accepted'
                  and ((r.from_id = p_user and r.to_id = v_other) or (r.from_id = v_other and r.to_id = p_user and r.status = 'pending'))
                limit 1));
end $$;

revoke execute on function public.srv_find_person(uuid, text) from public, anon, authenticated;
grant execute on function public.srv_find_person(uuid, text) to service_role;
revoke execute on function public.add_place(text, text, text, text, text) from public, anon;
revoke execute on function public.remove_place(uuid) from public, anon;
grant execute on function public.add_place(text, text, text, text, text) to authenticated;
grant execute on function public.remove_place(uuid) to authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
