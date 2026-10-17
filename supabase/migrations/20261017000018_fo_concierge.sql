-- ============================================================================
-- Fo Concierge (2026-10-17)
--   Fo (wajo.ai) is the concierge. It runs from ONE shared Wajo account that
--   Friend Flower connects once (npm run fo:connect), so:
--   - private.fo_auth holds that account's OAuth tokens; only the server
--     (service role) can read or write them.
--   - Each member gets their own private thread with Fo per chat. Nobody else
--     in the chat sees it, and Fo's conversation id never leaves the server.
--   - A member can send Fo a limited number of requests a day, and one at a
--     time: a new request waits until Fo has answered the last one.
-- ============================================================================

create table private.fo_auth (
  id            boolean primary key default true check (id),  -- a single row
  client_id     text not null,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

create table public.fo_threads (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  chat_id         uuid not null references public.chats(id) on delete cascade,
  conversation_id text,                    -- Fo's handle; never sent to the browser
  status          text not null default 'idle' check (status in ('idle', 'working')),
  progress        text,
  updated_at      timestamptz not null default now(),
  primary key (user_id, chat_id)
);

create table public.fo_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  chat_id    uuid not null references public.chats(id) on delete cascade,
  role       text not null check (role in ('me', 'fo')),
  body       text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index on public.fo_messages (user_id, chat_id, created_at);

-- No direct table access: members read their thread through fo_thread(),
-- and only the server writes.
alter table public.fo_threads enable row level security;
alter table public.fo_messages enable row level security;
revoke all on public.fo_threads, public.fo_messages from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Your thread with Fo in one chat: what you asked, what Fo said, and whether
-- Fo is still working on it.
-- ---------------------------------------------------------------------------
create or replace function public.fo_thread(p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(t.status, 'idle'),
    'progress', t.progress,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
      from public.fo_messages m
      where m.user_id = private.me() and m.chat_id = p_chat), '[]'::jsonb))
  from (select 1) one
  left join public.fo_threads t on t.user_id = private.me() and t.chat_id = p_chat;
$$;

-- ---------------------------------------------------------------------------
-- Server only: start a request. Checks the member can post in the chat, is
-- under the daily limit and isn't already waiting on Fo, then records the
-- request and returns what Fo needs to know about who is asking.
-- ---------------------------------------------------------------------------
create or replace function public.srv_fo_begin(p_user uuid, p_chat uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_thread public.fo_threads;
begin
  if not exists (select 1 from public.chat_members cm
                 where cm.chat_id = p_chat and cm.user_id = p_user and cm.left_at is null) then
    return jsonb_build_object('status', 'not_member');
  end if;

  select * into v_thread from public.fo_threads where user_id = p_user and chat_id = p_chat for update;
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
    'others', coalesce((select jsonb_agg(private.display_name(cm.user_id) order by cm.joined_at)
                        from public.chat_members cm
                        where cm.chat_id = p_chat and cm.user_id <> p_user and cm.left_at is null), '[]'::jsonb));
end $$;

-- Server only: where a member's thread stands (for polling Fo).
create or replace function public.srv_fo_state(p_user uuid, p_chat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', coalesce(t.status, 'idle'), 'conversation_id', t.conversation_id)
  from (select 1) one
  left join public.fo_threads t on t.user_id = p_user and t.chat_id = p_chat;
$$;

-- Server only: record what Fo said. 'working' updates the progress line;
-- 'complete' or 'failed' posts the reply and frees the thread.
create or replace function public.srv_fo_update(p_user uuid, p_chat uuid, p_conversation text, p_status text, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('working', 'complete', 'failed') then raise exception 'Unknown status %', p_status; end if;
  update public.fo_threads
  set conversation_id = coalesce(nullif(p_conversation, ''), conversation_id),
      status = case when p_status = 'working' then 'working' else 'idle' end,
      progress = case when p_status = 'working' then left(p_text, 300) end,
      updated_at = now()
  where user_id = p_user and chat_id = p_chat;
  if p_status <> 'working' and coalesce(p_text, '') <> '' then
    insert into public.fo_messages (user_id, chat_id, role, body) values (p_user, p_chat, 'fo', left(p_text, 8000));
  end if;
end $$;

-- Server only: the shared Fo account's tokens.
create or replace function public.srv_fo_auth()
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(a) from private.fo_auth a;
$$;

create or replace function public.srv_fo_save_auth(p_client_id text, p_access text, p_refresh text, p_expires_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into private.fo_auth (client_id, access_token, refresh_token, expires_at)
  values (p_client_id, p_access, p_refresh, p_expires_at)
  on conflict (id) do update set client_id = excluded.client_id, access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, private.fo_auth.refresh_token),
    expires_at = excluded.expires_at, updated_at = now();
$$;

revoke execute on function public.fo_thread(uuid) from public, anon;
grant execute on function public.fo_thread(uuid) to authenticated;
revoke execute on function public.srv_fo_begin(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.srv_fo_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.srv_fo_update(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.srv_fo_auth() from public, anon, authenticated;
revoke execute on function public.srv_fo_save_auth(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.srv_fo_begin(uuid, uuid, text) to service_role;
grant execute on function public.srv_fo_state(uuid, uuid) to service_role;
grant execute on function public.srv_fo_update(uuid, uuid, text, text, text) to service_role;
grant execute on function public.srv_fo_auth() to service_role;
grant execute on function public.srv_fo_save_auth(text, text, text, timestamptz) to service_role;
