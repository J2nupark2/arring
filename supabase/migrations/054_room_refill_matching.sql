-- A host can permanently remove a participant and refill only that vacancy
-- through the existing matching acceptance flow.
create table if not exists public.room_kicks (
  room_id uuid not null references public.rooms (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  kicked_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, target_id)
);

create index if not exists room_kicks_target_idx
  on public.room_kicks (target_id, created_at desc);

alter table public.room_kicks enable row level security;

create policy "kicks visible to involved room users"
  on public.room_kicks for select
  to authenticated
  using (target_id = auth.uid() or kicked_by = auth.uid());

revoke insert, update, delete on public.room_kicks from authenticated;

alter table public.match_requests
  add column if not exists refill_room_id uuid references public.rooms (id) on delete cascade,
  add column if not exists excluded_user_ids uuid[] not null default '{}';

create unique index if not exists match_requests_active_refill_room_unique_idx
  on public.match_requests (refill_room_id)
  where refill_room_id is not null and status in ('waiting', 'processing');

