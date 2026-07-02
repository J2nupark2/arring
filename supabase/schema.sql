-- Arring Phase 1 schema: profiles, rooms, room_participants
-- Run this in the Supabase Dashboard SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: drops any previous version of these objects first.

drop table if exists public.room_participants cascade;
drop table if exists public.rooms cascade;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user cascade;
drop function if exists public.is_room_participant cascade;
drop table if exists public.profiles cascade;

create extension if not exists pgcrypto;

-- profiles ------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- rooms -----------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'ended'))
);

alter table public.rooms enable row level security;

create policy "rooms are viewable by authenticated users"
  on public.rooms for select
  to authenticated
  using (true);

create policy "authenticated users can create rooms"
  on public.rooms for insert
  to authenticated
  with check (auth.uid() = created_by);

-- room_participants -------------------------------------------------------

create table public.room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index room_participants_room_id_idx on public.room_participants (room_id);
create index room_participants_user_id_idx on public.room_participants (user_id);

alter table public.room_participants enable row level security;

-- SECURITY DEFINER helper so membership checks below don't recurse into
-- room_participants' own RLS policy.
create function public.is_room_participant(target_room_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.room_participants
    where room_id = target_room_id and user_id = auth.uid()
  );
$$;

create policy "participants viewable by fellow participants"
  on public.room_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_room_participant(room_id)
  );

create policy "users can record own participation"
  on public.room_participants for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can update own participation"
  on public.room_participants for update
  to authenticated
  using (user_id = auth.uid());

-- rooms: allow the creator or a current participant to update room status
-- (e.g. marking it "ended" when the last participant leaves).
create policy "participants can update room status"
  on public.rooms for update
  to authenticated
  using (
    auth.uid() = created_by
    or public.is_room_participant(id)
  );
