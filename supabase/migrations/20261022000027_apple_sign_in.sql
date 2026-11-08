-- ============================================================================
-- Sign in with Apple: keep each person's Apple refresh token (2026-10-22)
--   Apple requires apps to revoke it when someone deletes their account.
--   /api/auth/apple-token (app) and /auth/confirm (website) save it with
--   srv_apple_token_save; /api/account/delete reads it with srv_apple_token_get
--   and revokes it before deleting the user. client_id is the bundle id for
--   the app or the Services ID for the website, since Apple needs the same one
--   to revoke. Nothing here is readable by members.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.apple_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  client_id text not null,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

revoke all on private.apple_tokens from public, anon, authenticated;

create or replace function public.srv_apple_token_save(p_user uuid, p_client text, p_token text)
returns void language sql security definer set search_path = '' as $$
  insert into private.apple_tokens (user_id, client_id, refresh_token) values (p_user, p_client, p_token)
  on conflict (user_id) do update set client_id = excluded.client_id, refresh_token = excluded.refresh_token, updated_at = now();
$$;

create or replace function public.srv_apple_token_get(p_user uuid)
returns table (client_id text, refresh_token text) language sql security definer set search_path = '' as $$
  select client_id, refresh_token from private.apple_tokens where user_id = p_user;
$$;

revoke execute on function public.srv_apple_token_save(uuid, text, text), public.srv_apple_token_get(uuid)
  from public, anon, authenticated;
grant execute on function public.srv_apple_token_save(uuid, text, text), public.srv_apple_token_get(uuid)
  to service_role;
