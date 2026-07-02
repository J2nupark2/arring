-- Arring Phase 1 schema: profiles, rooms, room_participants
-- Run this in the Supabase Dashboard SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: drops any previous version of these objects first.

drop table if exists public.room_participants cascade;
drop table if exists public.rooms cascade;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user cascade;
drop function if exists public.is_room_participant cascade;
drop function if exists public.room_member_count cascade;
drop function if exists public.list_public_rooms cascade;
drop table if exists public.profiles cascade;

create extension if not exists pgcrypto;

-- profiles ------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  server text,
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
  insert into public.profiles (id, nickname, server)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'server', '')
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
  title text not null default '파티 통화방',
  max_members integer not null default 6,
  is_public boolean not null default false,
  created_by uuid not null references public.profiles (id),
  host_id uuid references public.profiles (id),
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

-- Member counts are needed by non-participants (party finder list), but
-- room_participants RLS only lets participants see each other — so expose
-- the count through a SECURITY DEFINER function instead.
create function public.room_member_count(target_room_id uuid)
returns integer
language sql
security definer set search_path = public
stable
as $$
  select count(distinct user_id)::integer
  from public.room_participants
  where room_id = target_room_id and left_at is null;
$$;

-- One-shot listing for the party finder: public active rooms with their
-- creator's profile and current member count.
create function public.list_public_rooms()
returns table (
  id uuid,
  code text,
  title text,
  max_members integer,
  created_at timestamptz,
  creator_nickname text,
  creator_server text,
  member_count integer
)
language sql
security definer set search_path = public
stable
as $$
  select
    r.id,
    r.code,
    r.title,
    r.max_members,
    r.created_at,
    p.nickname,
    p.server,
    public.room_member_count(r.id)
  from public.rooms r
  join public.profiles p on p.id = r.created_by
  where r.is_public
    and r.status = 'active'
    and r.expires_at > now()
  order by r.created_at desc;
$$;
