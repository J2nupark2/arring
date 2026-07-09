-- Active matching rows must prove that the user's browser is still polling.
-- Without a heartbeat, users who close the page without cancelling remain as
-- stale candidates forever.

alter table public.match_requests
  add column if not exists heartbeat_at timestamptz not null default now();

alter table public.match_queue
  add column if not exists heartbeat_at timestamptz not null default now();

update public.match_requests
  set heartbeat_at = created_at
  where status in ('waiting', 'processing');

update public.match_queue
  set heartbeat_at = created_at
  where status in ('waiting', 'processing');

update public.match_requests
  set status = 'cancelled'
  where status in ('waiting', 'processing')
    and heartbeat_at < now() - interval '2 minutes';

update public.match_queue
  set status = 'cancelled'
  where status in ('waiting', 'processing')
    and heartbeat_at < now() - interval '2 minutes';

create index if not exists match_requests_active_heartbeat_idx
  on public.match_requests (status, heartbeat_at)
  where status in ('waiting', 'processing');

create index if not exists match_queue_active_heartbeat_idx
  on public.match_queue (status, heartbeat_at)
  where status in ('waiting', 'processing');
