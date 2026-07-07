-- Add an in-flight state so only one request can complete a waiting match.
-- This prevents simultaneous clients from creating separate rooms for the
-- same match request.

alter table public.match_requests
  drop constraint if exists match_requests_status_check;

alter table public.match_requests
  add constraint match_requests_status_check
  check (status in ('waiting', 'processing', 'matched', 'cancelled'));
