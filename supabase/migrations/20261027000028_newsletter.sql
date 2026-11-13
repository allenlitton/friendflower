-- ============================================================================
-- Newsletter sign-ups (2026-10-27)
--   Anyone can leave their email at the bottom of the sign-in page to hear
--   about Friend Flower news (like the App Store launch). Emails are kept in
--   a private table nobody can read through the API; signing up again with
--   the same email does nothing.
-- (Kept to plain ASCII on purpose so copy/paste can't garble it.)
-- ============================================================================

create table private.newsletter_signups (
  email text primary key,
  created_at timestamptz not null default now()
);
revoke all on private.newsletter_signups from public, anon, authenticated;

create or replace function public.newsletter_signup(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Please enter a valid email';
  end if;
  insert into private.newsletter_signups (email) values (v_email)
  on conflict (email) do nothing;
end $$;

revoke execute on function public.newsletter_signup(text) from public;
grant execute on function public.newsletter_signup(text) to anon, authenticated;
