-- ============================================================================
-- Delete a message (2026-10-13)
--   Applied to the remote project directly; pulled into the repo afterwards so
--   the migrations here match what is live.
--   You can delete your own messages (never system ones).
-- ============================================================================

create or replace function public.delete_message(p_message bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.me();
begin
  delete from public.messages
  where id = p_message and sender_id = v_me and kind <> 'system';
  if not found then raise exception 'You can only delete your own messages'; end if;
end $$;

grant execute on function public.delete_message(bigint) to authenticated;
