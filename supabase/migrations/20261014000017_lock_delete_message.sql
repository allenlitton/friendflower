-- ============================================================================
-- Lock down delete_message (2026-10-14)
--   Signed-in users only, like every other function.
-- ============================================================================

revoke execute on function public.delete_message(bigint) from public, anon;
grant execute on function public.delete_message(bigint) to authenticated;
