-- ============================================================================
-- Blossom, the paid plan (2026-10-20)
--   Blossom is $8/month. A code (FRIEND33) gives a year of it free.
--   Free plan:  World shows up to 5 saved friends, Nearby up to 10 people,
--               no Fo Concierge, no delivery requests (offering to carry stays
--               free), and Nearby only for where you are now, not future trips.
--   Blossom:    all of it, unlimited.
--   Memberships live in the private schema so nobody can grant themselves one.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.memberships (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  source     text not null check (source in ('code', 'paid')),
  code       text,
  until      timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.promo_codes (
  code       text primary key check (code = upper(code)),
  months     int not null check (months between 1 and 36),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table private.code_redemptions (
  code        text not null references private.promo_codes(code),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

-- Wrong guesses, so codes can't be fished for.
create table private.code_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  at      timestamptz not null default now()
);
create index code_attempts_user_at on private.code_attempts (user_id, at);

alter table private.memberships enable row level security;
alter table private.promo_codes enable row level security;
alter table private.code_redemptions enable row level security;
alter table private.code_attempts enable row level security;

insert into private.promo_codes (code, months) values ('FRIEND33', 12);

create or replace function private.is_blossom(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.memberships m where m.user_id = p_user and m.until > now());
$$;

-- What the app needs to know about your plan.
create or replace function public.my_plan()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plan', case when m.until > now() then 'blossom' else 'free' end,
    'until', m.until,
    'source', m.source,
    'friends', (select count(*) from public.friend_requests r
                where r.status = 'accepted' and (r.from_id = private.me() or r.to_id = private.me())))
  from (select 1) one
  left join private.memberships m on m.user_id = private.me();
$$;

-- Returns {plan, until}, or {error} (a returned error, not a raised one, so the
-- wrong guess is still logged).
create or replace function public.redeem_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_code private.promo_codes;
  v_until timestamptz;
begin
  if (select count(*) from private.code_attempts where user_id = v_me and at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('error', 'Too many tries. Please try again tomorrow.');
  end if;

  select * into v_code from private.promo_codes where code = upper(btrim(coalesce(p_code, ''))) and active;
  if v_code.code is null then
    insert into private.code_attempts (user_id) values (v_me);
    return jsonb_build_object('error', 'That code isn''t valid.');
  end if;
  if exists (select 1 from private.code_redemptions where code = v_code.code and user_id = v_me) then
    return jsonb_build_object('error', 'You''ve already used this code.');
  end if;

  insert into private.code_redemptions (code, user_id) values (v_code.code, v_me);
  -- Stacks on top of any Blossom time you already have.
  insert into private.memberships (user_id, source, code, until)
  values (v_me, 'code', v_code.code, now() + make_interval(months => v_code.months))
  on conflict (user_id) do update set
    source = 'code', code = excluded.code, updated_at = now(),
    until = greatest(private.memberships.until, now()) + make_interval(months => v_code.months)
  returning until into v_until;

  return jsonb_build_object('plan', 'blossom', 'until', v_until);
end $$;

-- ---------------------------------------------------------------------------
-- World: free plan shows your first 5 saved friends.
--   Same as world() in 20260925000002_functions.sql, apart from the limit.
-- ---------------------------------------------------------------------------
create or replace function public.world()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := private.me(); v_result jsonb;
begin
  with friends as (
    select case when r.from_id = v_me then r.to_id else r.from_id end as uid
    from public.friend_requests r
    where r.status = 'accepted' and (r.from_id = v_me or r.to_id = v_me)
    order by coalesce(r.responded_at, r.created_at), r.id
    limit case when private.is_blossom(v_me) then null else 5 end
  ),
  visible as (
    select f.uid, c.degree from friends f
    join private.circle(v_me) c on c.uid = f.uid
  ),
  spots as (
    -- where each friend is now
    select v.uid, w.city_id, w.presence, w.trip_start, w.trip_end, 0 as ord
    from visible v, lateral private.whereabouts(v.uid, v.degree, current_date) w
    union all
    -- and where they're headed in the next 120 days
    select v.uid, t.city_id, 'upcoming', t.starts_on, t.ends_on, 1
    from visible v
    join public.trips t on t.user_id = v.uid
    join public.profiles pr on pr.id = v.uid
    where t.starts_on > current_date and t.starts_on <= current_date + 120
      and private.trip_visible(t.visibility, pr.show_trips, v.degree)
  ),
  people as (
    select s.city_id,
      jsonb_agg(private.mini(s.uid) || jsonb_build_object(
        'online', private.is_online(s.uid), 'presence', s.presence,
        'from', s.trip_start, 'until', s.trip_end) order by s.ord, s.trip_start nulls first) as people,
      count(*) filter (where s.presence = 'lives') as based,
      count(*) filter (where s.presence = 'visiting') as visiting,
      count(*) filter (where s.presence = 'upcoming') as upcoming
    from spots s group by s.city_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'city_id', c.id, 'city', c.name, 'short', c.short_name, 'is_launched', c.is_launched,
      'people', p.people, 'based', p.based, 'visiting', p.visiting, 'upcoming', p.upcoming,
      'my_trip', (select jsonb_build_object('id', t.id, 'starts_on', t.starts_on, 'ends_on', t.ends_on)
                  from public.trips t where t.user_id = v_me and t.city_id = c.id and t.ends_on >= current_date
                  order by t.starts_on limit 1),
      'is_home', c.id = (select pr.home_city_id from public.profiles pr where pr.id = v_me))
    order by (c.id = (select pr.home_city_id from public.profiles pr where pr.id = v_me)) desc,
             jsonb_array_length(p.people) desc), '[]')
  into v_result
  from people p join public.cities c on c.id = p.city_id;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- The full versions move to private; the public ones check the plan first.
-- ---------------------------------------------------------------------------
alter function public.circle_in_city(text, date, date) set schema private;
alter function public.request_delivery(text, text, date, text, date) set schema private;
alter function public.srv_fo_begin(uuid, uuid, text) set schema private;
revoke execute on function private.circle_in_city(text, date, date) from public, anon, authenticated;
revoke execute on function private.request_delivery(text, text, date, text, date) from public, anon, authenticated;
revoke execute on function private.srv_fo_begin(uuid, uuid, text) from public, anon, authenticated, service_role;

-- Nearby: free plan sees the 10 closest, and only where they are now
-- (a day of slack for time zones), not a trip that hasn't started.
create or replace function public.circle_in_city(p_city text, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_all jsonb;
begin
  if private.is_blossom(private.me()) then
    return private.circle_in_city(p_city, p_from, p_to);
  end if;
  if coalesce(p_from, current_date) > current_date + 1 then
    raise exception 'Seeing who''s in a city before you get there is part of Blossom';
  end if;
  v_all := private.circle_in_city(p_city, p_from, p_to);
  return coalesce((select jsonb_agg(x.e order by x.i) from jsonb_array_elements(v_all) with ordinality x(e, i) where x.i <= 10), '[]'::jsonb);
end $$;

-- How many people Nearby would show on Blossom (for "and 12 more").
create or replace function public.circle_in_city_count(p_city text, p_from date default null, p_to date default null)
returns int language sql stable security definer set search_path = '' as $$
  select jsonb_array_length(private.circle_in_city(p_city, p_from, p_to));
$$;

create or replace function public.request_delivery(p_from text, p_to text, p_by date, p_scope text default 'network', p_after date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_blossom(private.me()) then raise exception 'Deliveries are part of Blossom'; end if;
  return private.request_delivery(p_from, p_to, p_by, p_scope, p_after);
end $$;

create or replace function public.srv_fo_begin(p_user uuid, p_chat uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_blossom(p_user) then return jsonb_build_object('status', 'blossom'); end if;
  return private.srv_fo_begin(p_user, p_chat, p_text);
end $$;

revoke execute on function private.is_blossom(uuid) from public, anon;
revoke execute on function public.my_plan() from public, anon;
revoke execute on function public.redeem_code(text) from public, anon;
revoke execute on function public.circle_in_city(text, date, date) from public, anon;
revoke execute on function public.circle_in_city_count(text, date, date) from public, anon;
revoke execute on function public.request_delivery(text, text, date, text, date) from public, anon;
revoke execute on function public.srv_fo_begin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.my_plan() to authenticated;
grant execute on function public.redeem_code(text) to authenticated;
grant execute on function public.circle_in_city(text, date, date) to authenticated;
grant execute on function public.circle_in_city_count(text, date, date) to authenticated;
grant execute on function public.request_delivery(text, text, date, text, date) to authenticated;
grant execute on function public.srv_fo_begin(uuid, uuid, text) to service_role;
revoke all on all tables in schema private from public, anon, authenticated;
