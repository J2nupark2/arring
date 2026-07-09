alter table public.profiles
  add column if not exists matchmaking_banned_until timestamptz,
  add column if not exists consecutive_failed_response_count integer not null default 0
    check (consecutive_failed_response_count >= 0);

create table if not exists public.temporary_matches (
  id uuid primary key default gen_random_uuid(),
  match_request_id uuid not null references public.match_requests (id) on delete cascade,
  leader_id uuid not null references public.profiles (id) on delete cascade,
  candidate_user_ids uuid[] not null default '{}',
  queue_ids uuid[] not null default '{}',
  status text not null default 'pending_acceptance'
    check (status in ('pending_acceptance', 'confirmed', 'cancelled', 'expired')),
  score numeric(6,5) not null default 0,
  expires_at timestamptz not null,
  room_id uuid references public.rooms (id) on delete set null,
  cancelled_reason text,
  created_at timestamptz not null default now()
);

create index if not exists temporary_matches_pending_idx
  on public.temporary_matches (status, expires_at);

create index if not exists temporary_matches_leader_idx
  on public.temporary_matches (leader_id, status, created_at desc);

create table if not exists public.match_responses (
  id uuid primary key default gen_random_uuid(),
  temporary_match_id uuid not null references public.temporary_matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (temporary_match_id, user_id)
);

create index if not exists match_responses_user_pending_idx
  on public.match_responses (user_id, status, created_at desc);

alter table public.temporary_matches enable row level security;
alter table public.match_responses enable row level security;

drop policy if exists "temporary matches visible to participants" on public.temporary_matches;
create policy "temporary matches visible to participants"
  on public.temporary_matches for select
  to authenticated
  using (
    leader_id = auth.uid()
    or auth.uid() = any(candidate_user_ids)
  );

drop policy if exists "match responses visible to participants" on public.match_responses;
create policy "match responses visible to participants"
  on public.match_responses for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.temporary_matches tm
      where tm.id = match_responses.temporary_match_id
        and (tm.leader_id = auth.uid() or auth.uid() = any(tm.candidate_user_ids))
    )
  );
