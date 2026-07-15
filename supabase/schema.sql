-- Arring Phase 1 schema: profiles, rooms, room_participants
-- Run this in the Supabase Dashboard SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: drops any previous version of these objects first.

drop table if exists public.dungeon_progress cascade;
drop table if exists public.kick_votes cascade;
drop table if exists public.party_reviews cascade;
drop trigger if exists on_party_review_created on public.party_reviews;
drop function if exists public.apply_party_review_temperature cascade;
drop table if exists public.match_responses cascade;
drop table if exists public.temporary_matches cascade;
drop table if exists public.match_queue cascade;
drop table if exists public.match_requests cascade;
drop table if exists public.dungeons cascade;
drop table if exists public.aion2_characters cascade;
drop function if exists public.is_admin cascade;
drop table if exists public.room_invites cascade;
drop function if exists public.send_room_invite cascade;
drop function if exists public.respond_room_invite cascade;
drop function if exists public.list_incoming_room_invites cascade;
drop table if exists public.direct_messages cascade;
drop function if exists public.send_message cascade;
drop function if exists public.list_messages cascade;
drop function if exists public.mark_conversation_read cascade;
drop table if exists public.friend_requests cascade;
drop function if exists public.touch_presence cascade;
drop function if exists public.set_current_room cascade;
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
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  current_room_code text,
  is_admin boolean not null default false,
  char_class text,
  combat_power integer,
  aion2_character_id text,
  aion2_character_name text,
  aion2_server_id integer,
  aion2_synced_at timestamptz,
  manner_temperature numeric(4,1) not null default 50.0,
  trust_temperature numeric(4,1) not null default 50.0,
  matchmaking_banned_until timestamptz,
  consecutive_failed_response_count integer not null default 0
    check (consecutive_failed_response_count >= 0)
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

-- last_seen_at/current_room_code must not be readable by arbitrary
-- authenticated users: current_room_code would let anyone look up which
-- room code any user is currently in and join a "private" (code-only) room
-- without ever being invited. Same column-privilege issue as password_hash
-- on rooms below — narrow the table-level grant, expose presence only
-- through list_friends() (SECURITY DEFINER, friends-only).
revoke select on public.profiles from authenticated, anon;
grant select (
  id, nickname, server, created_at, is_admin, char_class, combat_power,
  aion2_character_id, aion2_character_name, aion2_server_id, aion2_synced_at,
  manner_temperature, trust_temperature
) on public.profiles to authenticated;

-- Same trap for UPDATE: the default table-level grant would let any user
-- set is_admin=true on their own row (RLS restricts WHICH rows, not which
-- columns). char_class/combat_power are also excluded — they come from the
-- official site via the /api/aion2/link route (service role), so users
-- can't fake their combat power.
revoke update on public.profiles from authenticated, anon;
grant update (nickname, server) on public.profiles to authenticated;

-- aion2 characters ------------------------------------------------------

create table public.aion2_characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  character_id text not null,
  character_name text not null,
  server_id integer not null,
  server_name text not null,
  class_name text not null,
  character_level integer not null default 0,
  combat_power integer not null default 0,
  proficiency_score numeric(4,1) not null default 36.5,
  equipment jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  stigmas jsonb not null default '[]'::jsonb,
  is_primary boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, character_id, server_id)
);

create index aion2_characters_user_idx
  on public.aion2_characters (user_id, is_primary desc, synced_at desc);

create unique index aion2_public_character_unique_idx
  on public.aion2_characters (character_id, server_id)
  where user_id is null;

alter table public.aion2_characters enable row level security;

create policy "characters viewable by authenticated"
  on public.aion2_characters for select
  to authenticated
  using (true);

create policy "users can manage own characters"
  on public.aion2_characters for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.aion2_characters to authenticated;

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
  created_by uuid not null references public.profiles (id) on delete cascade,
  host_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  password_hash text
);

-- Column-level lock: RLS below allows any authenticated user to SELECT a
-- room row, but the hash itself must stay unreadable directly — only
-- SECURITY DEFINER functions (running as the table owner) can see it.
-- A column-level revoke alone doesn't work here because Supabase's default
-- privileges already grant table-level SELECT (all columns); that has to
-- be revoked first, then re-granted narrowly on just the safe columns.
revoke select on public.rooms from authenticated, anon;
grant select (
  id, code, title, max_members, is_public, created_by, host_id,
  created_at, expires_at, status
) on public.rooms to authenticated;

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
  user_id uuid not null references public.profiles (id) on delete cascade,
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

-- Creates a room with an optional password, bcrypt-hashed server-side via
-- pgcrypto so the plaintext never needs to round-trip through app code.
create function public.create_room(
  p_code text,
  p_title text,
  p_max_members integer,
  p_is_public boolean,
  p_password text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  insert into public.rooms (code, title, max_members, is_public, created_by, host_id, expires_at, password_hash)
  values (
    p_code, p_title, p_max_members, p_is_public, auth.uid(), auth.uid(), p_expires_at,
    case when p_password is not null and p_password <> '' then extensions.crypt(p_password, extensions.gen_salt('bf')) else null end
  )
  returning id into new_id;

  return new_id;
end;
$$;

create function public.room_has_password(target_room_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select password_hash is not null from public.rooms where id = target_room_id;
$$;

create function public.verify_room_password(target_room_id uuid, password text)
returns boolean
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  hash text;
begin
  select password_hash into hash from public.rooms where id = target_room_id;
  if hash is null then
    return true;
  end if;
  return extensions.crypt(coalesce(password, ''), hash) = hash;
end;
$$;

-- One-shot listing for the party finder: public active rooms with their
-- creator's profile, current member count, and whether a password is set.
create function public.list_public_rooms()
returns table (
  id uuid,
  code text,
  title text,
  max_members integer,
  created_at timestamptz,
  creator_nickname text,
  creator_server text,
  member_count integer,
  has_password boolean
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
    public.room_member_count(r.id),
    r.password_hash is not null
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

-- Lets the incoming-request badge/toast update instantly instead of
-- waiting on the 15s friend-list poll (same idea as direct_messages below
-- and room_invites further down).
alter publication supabase_realtime add table public.friend_requests;

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

-- direct_messages ---------------------------------------------------------
-- 1:1 friend messaging. Same shape as friend_requests above: RLS only
-- allows SELECT for the two people involved, all writes are blocked
-- directly and go through SECURITY DEFINER functions so "must be friends"
-- and "not a guest" live in one place instead of being re-checked by every
-- caller. Must be created before list_friends() below, which references it.

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> receiver_id)
);

create index direct_messages_pair_idx on public.direct_messages (sender_id, receiver_id, created_at);
create index direct_messages_receiver_unread_idx on public.direct_messages (receiver_id, read_at);

alter table public.direct_messages enable row level security;

create policy "involved users can view messages"
  on public.direct_messages for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "no direct inserts" on public.direct_messages for insert to authenticated with check (false);
create policy "no direct updates" on public.direct_messages for update to authenticated using (false);
create policy "no direct deletes" on public.direct_messages for delete to authenticated using (false);

-- Needed for the open-chat-window realtime subscription (postgres_changes).
-- RLS above still governs which rows each subscriber actually receives.
alter publication supabase_realtime add table public.direct_messages;

create function public.send_message(p_receiver_id uuid, p_body text)
returns table (
  id uuid,
  sender_id uuid,
  receiver_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  are_friends boolean;
  trimmed text := trim(p_body);
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'guests cannot send messages';
  end if;

  if me = p_receiver_id then
    raise exception 'cannot message yourself';
  end if;

  if trimmed = '' then
    raise exception 'message cannot be empty';
  end if;

  select exists (
    select 1 from public.friend_requests fr
    where fr.status = 'accepted'
      and ((fr.sender_id = me and fr.receiver_id = p_receiver_id)
        or (fr.sender_id = p_receiver_id and fr.receiver_id = me))
  ) into are_friends;

  if not are_friends then
    raise exception 'can only message friends';
  end if;

  return query
  insert into public.direct_messages (sender_id, receiver_id, body)
  values (me, p_receiver_id, trimmed)
  returning
    direct_messages.id,
    direct_messages.sender_id,
    direct_messages.receiver_id,
    direct_messages.body,
    direct_messages.created_at;
end;
$$;

create function public.list_messages(other_user_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  receiver_id uuid,
  body text,
  created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select id, sender_id, receiver_id, body, created_at
  from (
    select *
    from public.direct_messages
    where (sender_id = auth.uid() and receiver_id = other_user_id)
       or (sender_id = other_user_id and receiver_id = auth.uid())
    order by created_at desc
    limit 200
  ) recent
  order by created_at asc;
$$;

create function public.mark_conversation_read(other_user_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.direct_messages
  set read_at = now()
  where receiver_id = auth.uid()
    and sender_id = other_user_id
    and read_at is null;
$$;

create function public.list_friends()
returns table (
  user_id uuid,
  nickname text,
  server text,
  friends_since timestamptz,
  is_online boolean,
  current_room_code text,
  unread_count integer,
  character_row_id uuid,
  class_name text,
  combat_power integer
)
language sql
security definer set search_path = public
stable
as $$
  select
    other.id,
    other.nickname,
    other.server,
    fr.responded_at,
    other.last_seen_at is not null and other.last_seen_at > now() - interval '30 seconds',
    case
      when other.last_seen_at > now() - interval '30 seconds' then other.current_room_code
      else null
    end,
    (
      select count(*)::integer
      from public.direct_messages dm
      where dm.sender_id = other.id
        and dm.receiver_id = auth.uid()
        and dm.read_at is null
    ),
    friend_character.id,
    friend_character.class_name,
    friend_character.combat_power
  from public.friend_requests fr
  join public.profiles other
    on other.id = case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end
  left join lateral (
    select ac.id, ac.class_name, ac.combat_power
    from public.aion2_characters ac
    where ac.user_id = other.id
    order by ac.is_primary desc, ac.synced_at desc
    limit 1
  ) friend_character on true
  where fr.status = 'accepted'
    and (fr.sender_id = auth.uid() or fr.receiver_id = auth.uid())
  order by fr.responded_at desc;
$$;

-- Presence: a lightweight heartbeat (touch_presence, called on the existing
-- friend-list poll cycle) plus room join/leave (set_current_room) drive the
-- is_online/current_room_code columns above — no separate realtime channel
-- needed.
create function public.touch_presence()
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

create function public.set_current_room(p_room_code text)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set current_room_code = p_room_code where id = auth.uid();
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

-- room_invites -------------------------------------------------------------
-- Push-style room invites: a friend inside a call room invites another
-- friend directly. Same shape as friend_requests/direct_messages above.

create table public.room_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  room_code text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);

create index room_invites_receiver_idx on public.room_invites (receiver_id, status);

alter table public.room_invites enable row level security;

create policy "involved users can view invites"
  on public.room_invites for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "no direct inserts" on public.room_invites for insert to authenticated with check (false);
create policy "no direct updates" on public.room_invites for update to authenticated using (false);
create policy "no direct deletes" on public.room_invites for delete to authenticated using (false);

-- A call invite should feel instant, unlike the friend-list badges which
-- piggyback on the 15s poll — so this rides its own realtime subscription.
alter publication supabase_realtime add table public.room_invites;

create function public.send_room_invite(p_receiver_id uuid, p_room_code text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  are_friends boolean;
  am_in_room boolean;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'guests cannot send invites';
  end if;

  if me = p_receiver_id then
    raise exception 'cannot invite yourself';
  end if;

  select exists (
    select 1 from public.friend_requests fr
    where fr.status = 'accepted'
      and ((fr.sender_id = me and fr.receiver_id = p_receiver_id)
        or (fr.sender_id = p_receiver_id and fr.receiver_id = me))
  ) into are_friends;

  if not are_friends then
    raise exception 'can only invite friends';
  end if;

  select exists (
    select 1
    from public.room_participants rp
    join public.rooms r on r.id = rp.room_id
    where r.code = p_room_code
      and rp.user_id = me
      and rp.left_at is null
      and r.status = 'active'
  ) into am_in_room;

  if not am_in_room then
    raise exception 'you are not in that room';
  end if;

  insert into public.room_invites (sender_id, receiver_id, room_code)
  values (me, p_receiver_id, p_room_code);
end;
$$;

create function public.respond_room_invite(invite_id uuid, accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.room_invites
  set status = case when accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = invite_id
    and receiver_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'invite not found or already handled';
  end if;
end;
$$;

create function public.list_incoming_room_invites()
returns table (
  invite_id uuid,
  sender_id uuid,
  nickname text,
  room_code text,
  created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select ri.id, ri.sender_id, p.nickname, ri.room_code, ri.created_at
  from public.room_invites ri
  join public.profiles p on p.id = ri.sender_id
  where ri.receiver_id = auth.uid() and ri.status = 'pending'
  order by ri.created_at desc;
$$;

-- game data (Aion2 matching foundations) ------------------------------------
-- dungeons: admin-managed content list (원정/초월/성역) with per-dungeon
-- gimmick progress stages. dungeon_progress: each user's self-declared
-- progress per dungeon (honesty enforced socially via manner temperature).

create function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create table public.dungeons (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('원정', '초월', '성역')),
  name text not null,
  -- Ordered gimmick progress stages, e.g. {'1넴','2넴','막넴 경험','클리어'}.
  -- A user's dungeon_progress.stage is an index into this array (0 = none).
  gimmick_stages text[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.dungeons enable row level security;

create policy "dungeons viewable by authenticated"
  on public.dungeons for select
  to authenticated
  using (true);

create policy "active dungeons viewable by anonymous users"
  on public.dungeons for select
  to anon
  using (is_active = true);

grant select on public.dungeons to anon;

create table public.api_rate_limits (
  key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (key_hash, bucket_start)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if p_key_hash is null or length(p_key_hash) < 16 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit configuration';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits (key_hash, bucket_start, request_count, expires_at)
  values (p_key_hash, v_bucket, 1, v_bucket + make_interval(secs => p_window_seconds * 2))
  on conflict (key_hash, bucket_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into v_count;
  if random() < 0.01 then
    delete from public.api_rate_limits where expires_at < v_now;
  end if;
  v_retry_after := greatest(1, ceil(extract(epoch from (v_bucket + make_interval(secs => p_window_seconds) - v_now)))::integer);
  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(0, p_limit - v_count),
    'retryAfter', case when v_count > p_limit then v_retry_after else 0 end
  );
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

create policy "admins can insert dungeons"
  on public.dungeons for insert
  to authenticated
  with check (public.is_admin());

create policy "admins can update dungeons"
  on public.dungeons for update
  to authenticated
  using (public.is_admin());

create policy "admins can delete dungeons"
  on public.dungeons for delete
  to authenticated
  using (public.is_admin());

create table public.dungeon_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  dungeon_id uuid not null references public.dungeons (id) on delete cascade,
  stage integer not null default 0 check (stage >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, dungeon_id)
);

alter table public.dungeon_progress enable row level security;

-- Progress is intentionally readable by all signed-in users: party leaders
-- need to see applicants' declared progress to accept/reject them.
create policy "progress viewable by authenticated"
  on public.dungeon_progress for select
  to authenticated
  using (true);

create policy "users can declare own progress"
  on public.dungeon_progress for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can update own progress"
  on public.dungeon_progress for update
  to authenticated
  using (user_id = auth.uid());

create policy "users can delete own progress"
  on public.dungeon_progress for delete
  to authenticated
  using (user_id = auth.uid());

-- auto matching, reputation, and vote kicks -------------------------------

create table public.match_requests (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references public.profiles (id) on delete cascade,
  dungeon_id uuid not null references public.dungeons (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  character_row_id uuid references public.aion2_characters (id) on delete set null,
  required_stage integer not null default 0 check (required_stage >= 0),
  min_combat_power integer not null default 0 check (min_combat_power >= 0),
  required_classes text[] not null default '{}',
  max_members integer not null default 6 check (max_members between 2 and 12),
  status text not null default 'waiting' check (status in ('waiting', 'processing', 'matched', 'cancelled')),
  created_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
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
  character_row_id uuid references public.aion2_characters (id) on delete set null,
  requested_stage integer not null default 0 check (requested_stage >= 0),
  status text not null default 'waiting' check (status in ('waiting', 'processing', 'matched', 'cancelled')),
  match_request_id uuid references public.match_requests (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  created_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  matched_at timestamptz
);

create index match_queue_waiting_idx
  on public.match_queue (status, dungeon_id, requested_stage, created_at);

create unique index match_queue_active_unique_idx
  on public.match_queue (user_id)
  where status in ('waiting', 'processing');

create unique index match_requests_active_leader_unique_idx
  on public.match_requests (leader_id)
  where status in ('waiting', 'processing');

create index match_requests_active_heartbeat_idx
  on public.match_requests (status, heartbeat_at)
  where status in ('waiting', 'processing');

create index match_queue_active_heartbeat_idx
  on public.match_queue (status, heartbeat_at)
  where status in ('waiting', 'processing');

create table public.temporary_matches (
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

create index temporary_matches_pending_idx
  on public.temporary_matches (status, expires_at);

create index temporary_matches_leader_idx
  on public.temporary_matches (leader_id, status, created_at desc);

create table public.match_responses (
  id uuid primary key default gen_random_uuid(),
  temporary_match_id uuid not null references public.temporary_matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (temporary_match_id, user_id)
);

create index match_responses_user_pending_idx
  on public.match_responses (user_id, status, created_at desc);

alter table public.temporary_matches enable row level security;
alter table public.match_responses enable row level security;

create policy "temporary matches visible to participants"
  on public.temporary_matches for select
  to authenticated
  using (
    leader_id = auth.uid()
    or auth.uid() = any(candidate_user_ids)
  );

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
