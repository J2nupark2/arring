-- Room titles, member limits, and the public party-finder listing.
-- Safe to run on the live DB: no data is dropped.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.rooms
  add column if not exists title text not null default '파티 통화방',
  add column if not exists max_members integer not null default 6,
  add column if not exists is_public boolean not null default false;

-- Member counts are needed by non-participants (party finder list), but
-- room_participants RLS only lets participants see each other — so expose
-- the count through a SECURITY DEFINER function instead.
create or replace function public.room_member_count(target_room_id uuid)
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
create or replace function public.list_public_rooms()
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
