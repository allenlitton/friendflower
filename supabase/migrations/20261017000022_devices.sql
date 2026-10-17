-- ============================================================================
-- Friend Flower on the round device (2026-10-17)
--   The device runs its own app over Wi-Fi. To link it to an account:
--     1. it makes up a long secret, sends it to /api/device/pair and gets a
--        short code back (srv_device_pair_start), which it shows on screen;
--     2. the member types the code at friendflower.app/device (claim_device);
--     3. the device sees it's linked (srv_device_pair_status) and from then on
--        uses its secret as its key for /api/device/summary.
--   Only hashes of the secret are stored. Members can see and remove their
--   devices (my_devices, remove_device). The summary is built by calling the
--   same functions the app's pages use, as that member, so the device shows
--   nothing the member couldn't already see on friendflower.app.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  name text not null default 'Round device',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index devices_user on private.devices (user_id);

create table private.device_pairings (
  code text primary key,
  secret_hash text not null unique,
  user_id uuid references public.profiles(id) on delete cascade,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);

-- Failed code guesses per member, to stop anyone trying codes at random.
create table private.device_claim_failures (
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now()
);
create index device_claim_failures_user on private.device_claim_failures (user_id, at);

revoke all on private.devices, private.device_pairings, private.device_claim_failures from public, anon, authenticated;

-- Step 1 (server only): a new short code for this secret, valid 10 minutes.
create or replace function public.srv_device_pair_start(p_secret_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I
  v_code text;
begin
  if p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'Bad device secret'; end if;
  delete from private.device_pairings where expires_at < now() - interval '1 day';
  delete from private.device_pairings where secret_hash = p_secret_hash and user_id is null;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from private.device_pairings where code = v_code);
  end loop;
  insert into private.device_pairings (code, secret_hash) values (v_code, p_secret_hash);
  return jsonb_build_object('code', v_code, 'expires_in', 600);
end $$;

-- Step 2 (signed-in member): link the device showing this code to me.
create or replace function public.claim_device(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.me();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_pair private.device_pairings;
begin
  if (select count(*) from private.device_claim_failures f
      where f.user_id = v_me and f.at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  select * into v_pair from private.device_pairings p
  where p.code = v_code and p.user_id is null and p.expires_at > now()
  for update;
  if not found then
    insert into private.device_claim_failures (user_id) values (v_me);
    return jsonb_build_object('ok', false, 'error', 'That code isn''t right or has expired. Check the device for a new one.');
  end if;
  update private.device_pairings set user_id = v_me where code = v_code;
  insert into private.devices (user_id, token_hash) values (v_me, v_pair.secret_hash)
  on conflict (token_hash) do update set user_id = excluded.user_id, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Step 3 (server only): has the member typed the code in yet?
create or replace function public.srv_device_pair_status(p_secret_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pair private.device_pairings;
begin
  select * into v_pair from private.device_pairings p where p.secret_hash = p_secret_hash;
  if not found then
    return jsonb_build_object('linked', exists (select 1 from private.devices d where d.token_hash = p_secret_hash),
                              'expired', true);
  end if;
  if v_pair.user_id is not null then
    delete from private.device_pairings where code = v_pair.code;
    return jsonb_build_object('linked', true, 'expired', false);
  end if;
  return jsonb_build_object('linked', false, 'expired', v_pair.expires_at < now());
end $$;

create or replace function public.my_devices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'created_at', d.created_at,
                                               'last_seen_at', d.last_seen_at) order by d.created_at), '[]')
  from private.devices d where d.user_id = private.me();
$$;

create or replace function public.remove_device(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.devices d where d.id = p_id and d.user_id = private.me();
$$;

-- Run the app's own functions as this member (and put the caller back after).
create or replace function private.act_as(p_user uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{}'
                     else jsonb_build_object('sub', p_user)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
end $$;
revoke execute on function private.act_as(uuid) from public, anon, authenticated;

-- Everything the device's screens show, in one go (server only).
create or replace function public.srv_device_summary(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_city text;
  v_launched boolean;
  v_nearby jsonb := '[]';
  v_chats jsonb := '[]';
  v_world jsonb := '[]';
  v_places jsonb := '[]';
  v_trips jsonb;
  v_me jsonb;
begin
  update private.devices d set last_seen_at = now() where d.token_hash = p_token_hash
  returning d.user_id into v_user;
  if v_user is null then return jsonb_build_object('linked', false); end if;

  -- Where am I right now: a trip covering today (live one first), else home.
  select t.city_id into v_city from public.trips t
  where t.user_id = v_user and t.starts_on <= current_date and t.ends_on >= current_date
  order by t.from_live desc, t.starts_on limit 1;
  if v_city is null then
    select pr.home_city_id into v_city from public.profiles pr where pr.id = v_user;
  end if;
  select c.is_launched into v_launched from public.cities c where c.id = v_city;

  perform private.act_as(v_user);
  begin
    if v_launched then
      v_nearby := public.circle_in_city(v_city, current_date, current_date);
      v_places := public.venues_in(v_city);
    end if;
    v_chats := public.my_chats();
    v_world := public.world();
  exception when others then
    perform private.act_as(null);
    raise;
  end;
  perform private.act_as(null);

  select private.mini(v_user) into v_me;
  select coalesce(jsonb_agg(jsonb_build_object(
           'city', c.name, 'starts_on', t.starts_on, 'ends_on', t.ends_on,
           'now', t.starts_on <= current_date,
           'people', coalesce((select jsonb_array_length(w->'people') from jsonb_array_elements(v_world) w
                               where w->>'city_id' = t.city_id), 0))
         order by t.starts_on), '[]')
  into v_trips
  from public.trips t join public.cities c on c.id = t.city_id
  where t.user_id = v_user and t.ends_on >= current_date;

  return jsonb_build_object(
    'linked', true,
    'me', jsonb_build_object('first_name', v_me->>'first_name'),
    'city', (select c.name from public.cities c where c.id = v_city),
    'launched', coalesce(v_launched, false),
    'nearby', jsonb_build_object(
      'count', jsonb_array_length(v_nearby),
      'people', coalesce((select jsonb_agg(jsonb_build_object(
          'first_name', p->>'first_name', 'distance_mi', p->'distance_mi', 'live', p->'distance_live',
          'neighbourhood', p->>'neighbourhood', 'degree', p->'degree', 'mutual_count', p->'mutual_count',
          'via', p->'via_names', 'online', p->'online', 'visiting', p->>'presence' = 'visiting'))
        from (select p from jsonb_array_elements(v_nearby) p limit 20) x), '[]')),
    'chats', jsonb_build_object(
      'unread', (select count(*) from jsonb_array_elements(v_chats) c where (c->>'unread')::boolean),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'title', (select string_agg(m->>'first_name', ', ') from jsonb_array_elements(c->'members') m),
          'sender', c->'last'->>'sender', 'body', left(c->'last'->>'body', 140),
          'unread', (c->>'unread')::boolean, 'at', c->'last_message_at'))
        from (select c from jsonb_array_elements(v_chats) c limit 10) x), '[]')),
    'trips', v_trips,
    'places', coalesce((select jsonb_agg(jsonb_build_object(
        'name', v->>'name', 'kind', v->>'kind', 'neighbourhood', v->>'neighbourhood', 'walk_min', v->'walk_min',
        'regulars', jsonb_array_length(v->'regulars'),
        'who', (select jsonb_agg(r->>'first_name') from (select r from jsonb_array_elements(v->'regulars') r limit 3) y)))
      from (select v from jsonb_array_elements(v_places) v limit 15) x), '[]'));
end $$;

revoke execute on function public.srv_device_pair_start(text) from public, anon, authenticated;
revoke execute on function public.srv_device_pair_status(text) from public, anon, authenticated;
revoke execute on function public.srv_device_summary(text) from public, anon, authenticated;
grant execute on function public.srv_device_pair_start(text) to service_role;
grant execute on function public.srv_device_pair_status(text) to service_role;
grant execute on function public.srv_device_summary(text) to service_role;
revoke execute on function public.claim_device(text) from public, anon;
revoke execute on function public.my_devices() from public, anon;
revoke execute on function public.remove_device(uuid) from public, anon;
grant execute on function public.claim_device(text) to authenticated;
grant execute on function public.my_devices() to authenticated;
grant execute on function public.remove_device(uuid) to authenticated;
