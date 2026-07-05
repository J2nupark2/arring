-- Lightweight online/in-call presence for friends, piggybacked on the
-- existing 15s friend-list poll (no new realtime infra):
--   - touch_presence(): client calls this every poll cycle -> last_seen_at
--   - set_current_room(): useVoiceRoom calls this on join (room code) and
--     on leave (null)
-- "Online" = last_seen_at within the last 30s (comfortably wider than the
-- 15s poll interval so one missed tick doesn't flip a friend offline).
--
-- current_room_code must NOT be readable by arbitrary authenticated users:
-- it would let anyone look up which room code any user is currently in and
-- join a "private" (code-only) room without ever being invited. Same
-- column-privilege issue as 008's password_hash leak, so profiles gets the
-- same table-revoke + narrow-column-regrant treatment, and the presence
-- columns are only ever exposed via the SECURITY DEFINER list_friends().
-- Run in Supabase Dashboard > SQL Editor.

alter table public.profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists current_room_code text;

revoke select on public.profiles from authenticated, anon;
grant select (id, nickname, server, created_at) on public.profiles to authenticated;

create or replace function public.touch_presence()
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

create or replace function public.set_current_room(p_room_code text)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set current_room_code = p_room_code where id = auth.uid();
$$;

-- Return type (columns) changed, so create or replace alone won't work.
drop function if exists public.list_friends();

create function public.list_friends()
returns table (
  user_id uuid,
  nickname text,
  server text,
  friends_since timestamptz,
  is_online boolean,
  current_room_code text
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
    end
  from public.friend_requests fr
  join public.profiles other
    on other.id = case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end
  where fr.status = 'accepted'
    and (fr.sender_id = auth.uid() or fr.receiver_id = auth.uid())
  order by fr.responded_at desc;
$$;
