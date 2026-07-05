-- 1:1 friend messaging. Same shape as friend_requests: RLS only allows
-- SELECT for the two people involved, all writes are blocked directly and
-- go through SECURITY DEFINER functions so "must be friends" and "not a
-- guest" live in one place instead of being re-checked by every caller.
-- Run in Supabase Dashboard > SQL Editor.

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

-- Return type (columns) changed, so create or replace alone won't work.
drop function if exists public.list_friends();

create function public.list_friends()
returns table (
  user_id uuid,
  nickname text,
  server text,
  friends_since timestamptz,
  is_online boolean,
  current_room_code text,
  unread_count integer
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
    )
  from public.friend_requests fr
  join public.profiles other
    on other.id = case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end
  where fr.status = 'accepted'
    and (fr.sender_id = auth.uid() or fr.receiver_id = auth.uid())
  order by fr.responded_at desc;
$$;
