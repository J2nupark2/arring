-- Only an active waiting queue entry should be unique per user and dungeon.
-- Historical matched/cancelled rows must be allowed to accumulate so repeated
-- matching attempts do not fail when a previous cancelled row already exists.

alter table public.match_queue
  drop constraint if exists match_queue_user_id_dungeon_id_status_key;

drop index if exists match_queue_active_unique_idx;

create unique index match_queue_active_unique_idx
  on public.match_queue (user_id, dungeon_id)
  where status = 'waiting';
