-- Friend requests/friendships. A single row's status carries the whole
-- lifecycle: pending -> accepted/declined. An accepted row IS the
-- friendship (no separate `friends` table).
-- Safe to run on the live DB: no data is dropped.
-- Run in Supabase Dashboard > SQL Editor.

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
