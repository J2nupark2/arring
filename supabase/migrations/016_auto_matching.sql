-- Aion2 auto matching, reputation temperatures, and vote-kick foundations.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.profiles
  add column if not exists manner_temperature numeric(4,1) not null default 36.5,
  add column if not exists trust_temperature numeric(4,1) not null default 36.5;

grant select (manner_temperature, trust_temperature) on public.profiles to authenticated;

create table public.match_requests (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references public.profiles (id) on delete cascade,
  dungeon_id uuid not null references public.dungeons (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  required_stage integer not null default 0 check (required_stage >= 0),
  min_combat_power integer not null default 0 check (min_combat_power >= 0),
  required_classes text[] not null default '{}',
  max_members integer not null default 6 check (max_members between 2 and 12),
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  created_at timestamptz not null default now(),
  matched_at timestamptz
);

create index match_requests_waiting_idx
  on public.match_requests (status, dungeon_id, required_stage, min_combat_power, created_at);

alter table public.match_requests enable row level security;

create policy "match requests viewable by authenticated"
  on public.match_requests for select
  to authenticated
  using (true);

create policy "leaders can create match requests"
  on public.match_requests for insert
  to authenticated
  with check (leader_id = auth.uid());

create policy "leaders can cancel own match requests"
  on public.match_requests for update
  to authenticated
  using (leader_id = auth.uid())
  with check (leader_id = auth.uid());

create table public.match_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  dungeon_id uuid not null references public.dungeons (id) on delete cascade,
  requested_stage integer not null default 0 check (requested_stage >= 0),
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  match_request_id uuid references public.match_requests (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  unique (user_id, dungeon_id, status)
);

create index match_queue_waiting_idx
  on public.match_queue (status, dungeon_id, requested_stage, created_at);

alter table public.match_queue enable row level security;

create policy "queue visible by owner and leaders"
  on public.match_queue for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.match_requests mr
      where mr.id = match_queue.match_request_id and mr.leader_id = auth.uid()
    )
  );

create policy "users can join queue"
  on public.match_queue for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can update own queue"
  on public.match_queue for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.party_reviews (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewed_id uuid not null references public.profiles (id) on delete cascade,
  manner_delta numeric(3,1) not null default 0 check (manner_delta between -2 and 2),
  trust_delta numeric(3,1) not null default 0 check (trust_delta between -2 and 2),
  reason text,
  created_at timestamptz not null default now(),
  unique (room_id, reviewer_id, reviewed_id),
  check (reviewer_id <> reviewed_id)
);

alter table public.party_reviews enable row level security;

create policy "reviews visible to authenticated"
  on public.party_reviews for select
  to authenticated
  using (true);

create policy "participants can review matched party members"
  on public.party_reviews for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.room_participants rp
      where rp.room_id = party_reviews.room_id and rp.user_id = auth.uid()
    )
    and exists (
      select 1 from public.room_participants rp
      where rp.room_id = party_reviews.room_id and rp.user_id = reviewed_id
    )
  );

create function public.apply_party_review_temperature()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles
  set
    manner_temperature = greatest(0, least(99.9, manner_temperature + new.manner_delta)),
    trust_temperature = greatest(0, least(99.9, trust_temperature + new.trust_delta))
  where id = new.reviewed_id;
  return new;
end;
$$;

create trigger on_party_review_created
  after insert on public.party_reviews
  for each row execute function public.apply_party_review_temperature();

create table public.kick_votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, target_id, voter_id),
  check (target_id <> voter_id)
);

alter table public.kick_votes enable row level security;

create policy "room kick votes visible by participants"
  on public.kick_votes for select
  to authenticated
  using (public.is_room_participant(room_id));

create policy "participants can vote to kick"
  on public.kick_votes for insert
  to authenticated
  with check (
    voter_id = auth.uid()
    and public.is_room_participant(room_id)
    and exists (
      select 1 from public.room_participants rp
      where rp.room_id = kick_votes.room_id
        and rp.user_id = kick_votes.target_id
        and rp.left_at is null
    )
  );
