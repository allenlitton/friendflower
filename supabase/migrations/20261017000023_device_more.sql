-- ============================================================================
-- Round device: faces, a Places map, chats and Fo (2026-10-17)
--   The summary now carries ids (people, chats and their members, places) and
--   each place's position, so the device can fetch round photos and a map.
--   New server-only helpers let the device open a chat, post in it after the
--   member taps Send, and check whose photo it may fetch. As before, they run
--   the app's own functions as that member, so the device can do nothing the
--   member couldn't do on friendflower.app.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

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
          'id', p->>'uid', 'first_name', p->>'first_name', 'distance_mi', p->'distance_mi', 'live', p->'distance_live',
          'neighbourhood', p->>'neighbourhood', 'degree', p->'degree', 'mutual_count', p->'mutual_count',
          'via', p->'via_names', 'online', p->'online', 'visiting', p->>'presence' = 'visiting'))
        from (select p from jsonb_array_elements(v_nearby) p limit 20) x), '[]')),
    'chats', jsonb_build_object(
      'unread', (select count(*) from jsonb_array_elements(v_chats) c where (c->>'unread')::boolean),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c->>'id',
          'title', (select string_agg(m->>'first_name', ', ') from jsonb_array_elements(c->'members') m),
          'members', (select jsonb_agg(m->>'id') from jsonb_array_elements(c->'members') m),
          'sender', c->'last'->>'sender', 'body', left(c->'last'->>'body', 140),
          'unread', (c->>'unread')::boolean, 'at', c->'last_message_at'))
        from (select c from jsonb_array_elements(v_chats) c limit 10) x), '[]')),
    'trips', v_trips,
    'places', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v->>'id', 'lat', ve.lat, 'lng', ve.lng,
        'name', v->>'name', 'kind', v->>'kind', 'neighbourhood', v->>'neighbourhood', 'walk_min', v->'walk_min',
        'regulars', jsonb_array_length(v->'regulars'),
        'who', (select jsonb_agg(r->>'first_name') from (select r from jsonb_array_elements(v->'regulars') r limit 3) y))
        order by x.n)
      from jsonb_array_elements(v_places) with ordinality x(v, n)
      join public.venues ve on ve.id = (x.v->>'id')::uuid
      where x.n <= 15), '[]'));
end $$;

-- The member a device key belongs to (null once it's removed).
create or replace function public.srv_device_user(p_token_hash text)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.user_id from private.devices d where d.token_hash = p_token_hash;
$$;

-- Whose photo the device may show: the member, their circle, and anyone they
-- share a chat with.
create or replace function public.srv_device_can_see(p_token_hash text, p_person uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := public.srv_device_user(p_token_hash);
begin
  if v_user is null then return false; end if;
  return v_user = p_person
    or exists (select 1 from private.circle(v_user) c where c.uid = p_person)
    or exists (select 1 from public.chat_members a join public.chat_members b on b.chat_id = a.chat_id
               where a.user_id = v_user and b.user_id = p_person);
end $$;

-- One chat for the device: who's in it and its last 20 messages. Opening it
-- marks it read, as on the site.
create or replace function public.srv_device_chat(p_token_hash text, p_chat uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.srv_device_user(p_token_hash); v_result jsonb;
begin
  if v_user is null then return jsonb_build_object('linked', false); end if;
  if not exists (select 1 from public.chat_members m where m.chat_id = p_chat and m.user_id = v_user) then
    return null;
  end if;
  select jsonb_build_object(
    'linked', true, 'id', p_chat,
    'can_post', private.is_active_member(p_chat, v_user),
    'members', (select jsonb_agg(jsonb_build_object('id', m.user_id, 'first_name', pr.first_name))
                from public.chat_members m join public.profiles pr on pr.id = m.user_id
                where m.chat_id = p_chat and m.user_id <> v_user),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
        'mine', x.sender_id = v_user, 'kind', x.kind, 'body', left(x.body, 400),
        'sender', (select pr.first_name from public.profiles pr where pr.id = x.sender_id),
        'at', x.created_at) order by x.created_at)
      from (select msg.* from public.messages msg
            where msg.chat_id = p_chat and msg.created_at <= private.member_left_at(p_chat, v_user)
            order by msg.created_at desc limit 20) x), '[]'))
  into v_result;
  update public.chat_members set last_read_at = now() where chat_id = p_chat and user_id = v_user;
  return v_result;
end $$;

-- Post in a chat as the member (only after they tap Send on the device).
create or replace function public.srv_device_send(p_token_hash text, p_chat uuid, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.srv_device_user(p_token_hash); v_id bigint;
begin
  if v_user is null then raise exception 'Device not linked'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Empty message'; end if;
  perform private.act_as(v_user);
  begin
    v_id := public.send_message(p_chat, left(p_body, 2000));
  exception when others then
    perform private.act_as(null);
    raise;
  end;
  perform private.act_as(null);
  return v_id;
end $$;

revoke execute on function public.srv_device_summary(text) from public, anon, authenticated;
revoke execute on function public.srv_device_user(text) from public, anon, authenticated;
revoke execute on function public.srv_device_can_see(text, uuid) from public, anon, authenticated;
revoke execute on function public.srv_device_chat(text, uuid) from public, anon, authenticated;
revoke execute on function public.srv_device_send(text, uuid, text) from public, anon, authenticated;
grant execute on function public.srv_device_summary(text) to service_role;
grant execute on function public.srv_device_user(text) to service_role;
grant execute on function public.srv_device_can_see(text, uuid) to service_role;
grant execute on function public.srv_device_chat(text, uuid) to service_role;
grant execute on function public.srv_device_send(text, uuid, text) to service_role;
