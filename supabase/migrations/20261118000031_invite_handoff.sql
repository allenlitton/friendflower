-- ============================================================================
-- Invite hand-off through the App Store (2026-11-18)
--   On an iPhone without the app, an invite link sends you straight to the
--   App Store. The App Store can't carry the invite code along, so just before
--   the redirect the server notes "this network opened invite X" (as a peppered
--   hash of the IP address, never the address itself). When someone finishes
--   sign-up in the app with no invite of their own, the most recent invite
--   opened from the same network in the last hour is redeemed for them.
--   Notes are used once and expire after an hour.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.invite_handoffs (
  ip_hash text not null,
  code text not null,
  created_at timestamptz not null default now()
);
create index invite_handoffs_ip_idx on private.invite_handoffs (ip_hash, created_at desc);
revoke all on private.invite_handoffs from public, anon, authenticated;

-- Server only: remember that this network opened an invite.
create or replace function public.srv_note_invite_handoff(p_ip_hash text, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where invite_code = p_code) then return; end if;
  delete from private.invite_handoffs where created_at < now() - interval '1 hour';
  insert into private.invite_handoffs (ip_hash, code) values (p_ip_hash, p_code);
end $$;

-- Server only: take (and forget) the latest invite opened from this network.
create or replace function public.srv_take_invite_handoff(p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  select code into v_code from private.invite_handoffs
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
   order by created_at desc limit 1;
  delete from private.invite_handoffs where ip_hash = p_ip_hash;
  return v_code;
end $$;

revoke execute on function public.srv_note_invite_handoff(text, text) from public, anon, authenticated;
revoke execute on function public.srv_take_invite_handoff(text) from public, anon, authenticated;
grant execute on function public.srv_note_invite_handoff(text, text) to service_role;
grant execute on function public.srv_take_invite_handoff(text) to service_role;
