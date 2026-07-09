create table if not exists public.matching_invites (
  id uuid primary key default gen_random_uuid(),
  match_request_id uuid not null references public.match_requests (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (match_request_id, receiver_id),
  check (sender_id <> receiver_id)
);

create index if not exists matching_invites_receiver_status_idx
  on public.matching_invites (receiver_id, status, created_at desc);

create index if not exists matching_invites_request_status_idx
  on public.matching_invites (match_request_id, status);

alter table public.matching_invites enable row level security;

drop policy if exists "matching invites visible to involved users" on public.matching_invites;
create policy "matching invites visible to involved users"
  on public.matching_invites for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "no direct matching invite inserts" on public.matching_invites;
create policy "no direct matching invite inserts"
  on public.matching_invites for insert
  to authenticated
  with check (false);

drop policy if exists "no direct matching invite updates" on public.matching_invites;
create policy "no direct matching invite updates"
  on public.matching_invites for update
  to authenticated
  using (false);

do $$
begin
  alter publication supabase_realtime add table public.matching_invites;
exception
  when duplicate_object then null;
end $$;
