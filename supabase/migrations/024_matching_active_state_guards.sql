-- Harden the matching state machine:
-- - a member queue can be claimed as processing before room creation
-- - one user can only have one active queue, regardless of dungeon
-- - one leader can only have one active request

alter table public.match_queue
  drop constraint if exists match_queue_status_check;

alter table public.match_queue
  add constraint match_queue_status_check
  check (status in ('waiting', 'processing', 'matched', 'cancelled'));

drop index if exists match_queue_active_unique_idx;

with ranked_active_queues as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc, id desc
    ) as active_rank
  from public.match_queue
  where status in ('waiting', 'processing')
)
update public.match_queue mq
set status = 'cancelled'
from ranked_active_queues ranked
where mq.id = ranked.id
  and ranked.active_rank > 1;

create unique index match_queue_active_unique_idx
  on public.match_queue (user_id)
  where status in ('waiting', 'processing');

drop index if exists match_requests_active_leader_unique_idx;

with ranked_active_requests as (
  select
    id,
    row_number() over (
      partition by leader_id
      order by created_at desc, id desc
    ) as active_rank
  from public.match_requests
  where status in ('waiting', 'processing')
)
update public.match_requests mr
set status = 'cancelled'
from ranked_active_requests ranked
where mr.id = ranked.id
  and ranked.active_rank > 1;

create unique index match_requests_active_leader_unique_idx
  on public.match_requests (leader_id)
  where status in ('waiting', 'processing');
