-- ============================================================================
-- Delete your own message (2026-10-12)
--   Removes it for everyone in the chat, with no receipt left behind.
--   Only the sender can delete, and only chat messages (not system notes).
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
