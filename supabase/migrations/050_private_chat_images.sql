insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-chat-images',
  'private-chat-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.support_inquiries
  add column if not exists image_path text;

alter table public.direct_messages
  add column if not exists image_path text;

alter table public.direct_messages
  drop constraint if exists direct_messages_body_check;

alter table public.direct_messages
  add constraint direct_messages_body_or_image_check check (
    char_length(body) <= 2000
    and (char_length(body) >= 1 or image_path is not null)
  );

drop function if exists public.send_message(uuid, text);
drop function if exists public.list_messages(uuid);

create function public.send_message(
  p_receiver_id uuid,
  p_body text,
  p_image_path text default null
)
returns table (
  id uuid,
  sender_id uuid,
  receiver_id uuid,
  body text,
  image_path text,
  created_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  are_friends boolean;
  trimmed text := trim(coalesce(p_body, ''));
  first_user uuid;
  second_user uuid;
  expected_prefix text;
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'authenticated account required';
  end if;

  if me = p_receiver_id then
    raise exception 'cannot message yourself';
  end if;

  if trimmed = '' and p_image_path is null then
    raise exception 'message cannot be empty';
  end if;

  if char_length(trimmed) > 2000 then
    raise exception 'message is too long';
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

  if me::text < p_receiver_id::text then
    first_user := me;
    second_user := p_receiver_id;
  else
    first_user := p_receiver_id;
    second_user := me;
  end if;
  expected_prefix := 'direct-messages/' || first_user || '_' || second_user || '/' || me || '/';

  if p_image_path is not null and (
    p_image_path not like expected_prefix || '%'
    or p_image_path !~ '\.(jpg|png|webp)$'
  ) then
    raise exception 'invalid message image';
  end if;

  return query
  insert into public.direct_messages (sender_id, receiver_id, body, image_path)
  values (me, p_receiver_id, trimmed, p_image_path)
  returning
    direct_messages.id,
    direct_messages.sender_id,
    direct_messages.receiver_id,
    direct_messages.body,
    direct_messages.image_path,
    direct_messages.created_at;
end;
$$;

create function public.list_messages(other_user_id uuid)
returns table (
  id uuid,
  sender_id uuid,
  receiver_id uuid,
  body text,
  image_path text,
  created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
  select id, sender_id, receiver_id, body, image_path, created_at
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

revoke all on function public.send_message(uuid, text, text) from public;
revoke all on function public.list_messages(uuid) from public;
grant execute on function public.send_message(uuid, text, text) to authenticated;
grant execute on function public.list_messages(uuid) to authenticated;
