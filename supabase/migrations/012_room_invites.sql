-- Push-style room invites: a friend inside a call room invites another
-- friend directly. Same shape as friend_requests/direct_messages — RLS
-- only allows SELECT for the two people involved, all writes go through
-- SECURITY DEFINER functions.
-- Run in Supabase Dashboard > SQL Editor.

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

  -- Defense in depth: the sender must actually be an active participant of
  -- the room they claim to be inviting into, not just any room code.
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
