-- ============================================================================
-- Remove the first "Fo sees your World" attempt (2026-10-19)
--   An earlier version (#21, closed) was applied to the live database without
--   being merged. It gave Fo every saved friend's whereabouts with no opt-in.
--   The opt-in version (fo_friends, next migration) replaces it, so its
--   objects go. "if exists" because they were never in this repository.
-- ============================================================================

drop function if exists public.fo_send_proposal(bigint);
drop function if exists public.fo_dismiss_proposal(bigint);
drop function if exists public.srv_fo_propose(uuid, uuid, text, uuid[]);
drop function if exists public.srv_fo_world(uuid);
drop table if exists public.fo_sends;
