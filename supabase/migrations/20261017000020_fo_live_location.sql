-- ============================================================================
-- Fo Concierge knows where you are (2026-10-17)
--   With Live distance on, each request to Fo now includes your latest live
--   position (already rounded to ~100 m) and the nearest neighbourhood and
--   city, so Fo doesn't have to ask. Only positions from the last 30 minutes
--   are used, and nothing is sent when Live distance is off.
-- ============================================================================

create or replace function private.fo_location(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'lat', l.lat, 'lng', l.lng,
    'neighbourhood', (select n.name from public.neighbourhoods n
                      where private.miles(l.lat, l.lng, n.lat, n.lng) < 3
                      order by private.miles(l.lat, l.lng, n.lat, n.lng) limit 1),
    'city', (select c.name from public.cities c
             where private.miles(l.lat, l.lng, c.lat, c.lng) < 60
             order by private.miles(l.lat, l.lng, c.lat, c.lng) limit 1))
  from private.live_locations l
  join public.profiles pr on pr.id = l.user_id
  where l.user_id = p_user
    and pr.share_live_location and pr.show_distance
    and l.updated_at > now() - interval '30 minutes';
$$;
revoke execute on function private.fo_location(uuid) from public, anon, authenticated;

-- p_chat null = the member's thread outside chats (no membership to check,
-- nobody else to mention).
create or replace function public.srv_fo_begin(p_user uuid, p_chat uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_thread public.fo_threads;
begin
  if p_chat is not null and not exists (select 1 from public.chat_members cm
                 where cm.chat_id = p_chat and cm.user_id = p_user and cm.left_at is null) then
    return jsonb_build_object('status', 'not_member');
  end if;

  select * into v_thread from public.fo_threads where user_id = p_user and chat_id is not distinct from p_chat for update;
  -- A turn nobody came back for counts as finished after 15 minutes.
  if v_thread.status = 'working' and v_thread.updated_at > now() - interval '15 minutes' then
    return jsonb_build_object('status', 'busy');
  end if;

  if (select count(*) from public.fo_messages
      where user_id = p_user and role = 'me' and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('status', 'limit');
  end if;

  insert into public.fo_messages (user_id, chat_id, role, body) values (p_user, p_chat, 'me', left(p_text, 2000));
  insert into public.fo_threads (user_id, chat_id, status, progress)
  values (p_user, p_chat, 'working', null)
  on conflict (user_id, chat_id) do update set status = 'working', progress = null, updated_at = now();

  return jsonb_build_object(
    'status', 'ok',
    'conversation_id', v_thread.conversation_id,
    'me', private.display_name(p_user),
    'home_city', (select c.name from public.profiles pr join public.cities c on c.id = pr.home_city_id where pr.id = p_user),
    'location', private.fo_location(p_user),
    'others', coalesce((select jsonb_agg(private.display_name(cm.user_id) order by cm.joined_at)
                        from public.chat_members cm
                        where cm.chat_id = p_chat and cm.user_id <> p_user and cm.left_at is null), '[]'::jsonb));
end $$;
