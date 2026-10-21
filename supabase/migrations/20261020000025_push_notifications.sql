-- ============================================================================
-- Push notifications for the iPhone app (2026-10-20)
--   The app registers its APNs device token (srv_push_register, called by
--   /api/push/register). New chat messages and friend requests / acceptances
--   add a row to private.push_outbox. A trigger then pings /api/push/send
--   (through pg_net, if the project has it and private.push_config is filled in)
--   which drains the outbox with srv_push_claim and talks to Apple.
--   If a ping is ever missed, the next one sends whatever is waiting.
--   Nothing here is readable by members: only the server (service_role) and
--   the triggers touch these tables.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  env text check (env in ('production', 'sandbox')),   -- which Apple gateway accepted it last
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_tokens_user on private.push_tokens (user_id);

create table private.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null,
  created_at timestamptz not null default now()
);

-- One row: where to ping and the shared secret. Fill in by hand after deploy:
--   insert into private.push_config (url, secret) values ('https://friendflower.app/api/push/send', '<PUSH_SECRET>');
create table private.push_config (
  only_row boolean primary key default true check (only_row),
  url text not null,
  secret text not null
);

revoke all on private.push_tokens, private.push_outbox, private.push_config from public, anon, authenticated;

-- Queue a notification for one person, only if they have the app registered.
create or replace function private.push_enqueue(p_user uuid, p_title text, p_body text, p_url text)
returns void language sql security definer set search_path = '' as $$
  insert into private.push_outbox (user_id, title, body, url)
  select p_user, p_title, left(p_body, 140), p_url
  where exists (select 1 from private.push_tokens t where t.user_id = p_user);
$$;

-- After a new outbox row, ask the server to send. Never lets a failure break the write.
create or replace function private.push_kick()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cfg private.push_config;
begin
  select * into v_cfg from private.push_config;
  if v_cfg.url is null or to_regnamespace('net') is null then return null; end if;
  begin
    execute 'select net.http_post(url := $1, headers := $2, body := $3)'
      using v_cfg.url,
            jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_cfg.secret),
            '{}'::jsonb;
  exception when others then
    null;
  end;
  return null;
end $$;

create trigger push_outbox_kick after insert on private.push_outbox
  for each statement execute function private.push_kick();

-- New chat message -> everyone else still in the chat who hasn't blocked / been blocked.
create or replace function private.push_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  if new.sender_id is null or new.kind = 'system' then return null; end if;
  for m in
    select cm.user_id from public.chat_members cm
    where cm.chat_id = new.chat_id and cm.left_at is null and cm.user_id <> new.sender_id
      and not private.is_blocked(new.sender_id, cm.user_id)
  loop
    perform private.push_enqueue(m.user_id, private.display_name(new.sender_id),
      case when new.kind = 'venue' then 'Suggested a place: ' || new.body else new.body end,
      '/chat/' || new.chat_id);
  end loop;
  return null;
end $$;

create trigger push_message after insert on public.messages
  for each row execute function private.push_on_message();

-- Friend request sent -> the person it's for. Accepted -> the person who asked.
create or replace function private.push_on_friend_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.push_enqueue(new.to_id, private.display_name(new.from_id), 'wants to be friends', '/chats');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.push_enqueue(new.from_id, private.display_name(new.to_id), 'accepted your friend request', '/people/' || new.to_id);
  end if;
  return null;
end $$;

create trigger push_friend_request after insert or update of status on public.friend_requests
  for each row execute function private.push_on_friend_request();

-- Server-only entry points (called with the service role from /api/push/*).
create or replace function public.srv_push_register(p_user uuid, p_token text)
returns void language sql security definer set search_path = '' as $$
  insert into private.push_tokens (token, user_id) values (p_token, p_user)
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
$$;

create or replace function public.srv_push_unregister(p_user uuid, p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from private.push_tokens where token = p_token and user_id = p_user;
$$;

-- Takes everything waiting (oldest first, up to p_limit) with each person's tokens.
create or replace function public.srv_push_claim(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  delete from private.push_outbox where created_at < now() - interval '1 day';
  with taken as (
    delete from private.push_outbox o
    where o.id in (select id from private.push_outbox order by id limit p_limit for update skip locked)
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'title', t.title, 'body', t.body, 'url', t.url,
    'tokens', (select coalesce(jsonb_agg(jsonb_build_object('token', k.token, 'env', k.env)), '[]'::jsonb)
               from private.push_tokens k where k.user_id = t.user_id)
  ) order by t.id), '[]'::jsonb) into v_out from taken t;
  return v_out;
end $$;

create or replace function public.srv_push_token_result(p_token text, p_env text, p_dead boolean)
returns void language sql security definer set search_path = '' as $$
  with gone as (delete from private.push_tokens where p_dead and token = p_token)
  update private.push_tokens set env = p_env where not p_dead and token = p_token;
$$;

revoke execute on function private.push_enqueue(uuid, text, text, text), private.push_kick(),
  private.push_on_message(), private.push_on_friend_request() from public, anon, authenticated;
revoke execute on function public.srv_push_register(uuid, text), public.srv_push_unregister(uuid, text),
  public.srv_push_claim(int), public.srv_push_token_result(text, text, boolean) from public, anon, authenticated;
grant execute on function public.srv_push_register(uuid, text), public.srv_push_unregister(uuid, text),
  public.srv_push_claim(int), public.srv_push_token_result(text, text, boolean) to service_role;
