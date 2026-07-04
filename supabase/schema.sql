-- Arring Phase 1 schema: profiles, rooms, room_participants
-- Run this in the Supabase Dashboard SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: drops any previous version of these objects first.

drop table if exists public.friend_requests cascade;
drop function if exists public.send_friend_request cascade;
drop function if exists public.respond_friend_request cascade;
drop function if exists public.remove_friend cascade;
drop function if exists public.list_friends cascade;
drop function if exists public.list_incoming_friend_requests cascade;
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

-- friend_requests -------------------------------------------------------
-- A single row's status carries the whole lifecycle: pending ->
-- accepted/declined. An accepted row IS the friendship (no separate
-- `friends` table).

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);

create index friend_requests_receiver_idx on public.friend_requests (receiver_id, status);
create index friend_requests_sender_idx on public.friend_requests (sender_id, status);

alter table public.friend_requests enable row level security;

create policy "involved users can view requests"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- All writes go through the SECURITY DEFINER functions below so the
-- business rules (no self-friending, no duplicate pending pairs, mutual
-- requests auto-accept, guests excluded) live in one place.
create policy "no direct inserts" on public.friend_requests for insert to authenticated with check (false);
create policy "no direct updates" on public.friend_requests for update to authenticated using (false);
create policy "no direct deletes" on public.friend_requests for delete to authenticated using (false);

create function public.send_friend_request(target_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing record;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'guests cannot add friends';
  end if;

  if me = target_id then
    raise exception 'cannot add yourself';
  end if;

  select * into existing
  from public.friend_requests
  where (sender_id = me and receiver_id = target_id)
     or (sender_id = target_id and receiver_id = me)
  order by created_at desc
  limit 1;

  if existing.id is not null then
    if existing.status = 'accepted' then
      return 'already_friends';
    elsif existing.status = 'pending' and existing.sender_id = me then
      return 'already_sent';
    elsif existing.status = 'pending' and existing.sender_id = target_id then
      update public.friend_requests
      set status = 'accepted', responded_at = now()
      where id = existing.id;
      return 'auto_accepted';
    elsif existing.status = 'declined' then
      update public.friend_requests
      set sender_id = me, receiver_id = target_id, status = 'pending',
          created_at = now(), responded_at = null
      where id = existing.id;
      return 'sent';
    end if;
  end if;

  insert into public.friend_requests (sender_id, receiver_id)
  values (me, target_id);
  return 'sent';
end;
$$;

create function public.respond_friend_request(request_id uuid, accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.friend_requests
  set status = case when accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = request_id
    and receiver_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'request not found or already handled';
  end if;
end;
$$;

create function public.remove_friend(other_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.friend_requests
  where status = 'accepted'
    and ((sender_id = auth.uid() and receiver_id = other_user_id)
      or (sender_id = other_user_id and receiver_id = auth.uid()));
end;
$$;

create function public.list_friends()
returns table (
  user_id uuid,
  nickname text,
  server text,
  friends_since timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select
    case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end,
    p.nickname,
    p.server,
    fr.responded_at
  from public.friend_requests fr
  join public.profiles p
    on p.id = case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end
  where fr.status = 'accepted'
    and (fr.sender_id = auth.uid() or fr.receiver_id = auth.uid())
  order by fr.responded_at desc;
$$;

create function public.list_incoming_friend_requests()
returns table (
  request_id uuid,
  sender_id uuid,
  nickname text,
  server text,
  created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select fr.id, fr.sender_id, p.nickname, p.server, fr.created_at
  from public.friend_requests fr
  join public.profiles p on p.id = fr.sender_id
  where fr.receiver_id = auth.uid() and fr.status = 'pending'
  order by fr.created_at desc;
$$;
