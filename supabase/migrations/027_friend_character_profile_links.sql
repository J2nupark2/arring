-- Expose the representative character row id wherever the UI shows another
-- player, so friend and room cards can link to the same character detail page.

drop function if exists public.list_friends();

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

drop function if exists public.search_friend_candidates(text);

create function public.search_friend_candidates(search_query text)
returns table (
  user_id uuid,
  nickname text,
  server text,
  email text,
  character_row_id uuid,
  relation_status text
)
language sql
security definer set search_path = public
stable
as $$
  with q as (
    select trim(coalesce(search_query, '')) as value
  )
  select
    p.id,
    p.nickname,
    p.server,
    case when lower(u.email) = lower(q.value) then u.email else null end,
    representative_character.id,
    case
      when fr.status = 'accepted' then 'friends'
      when fr.status = 'pending' and fr.sender_id = auth.uid() then 'sent'
      when fr.status = 'pending' and fr.receiver_id = auth.uid() then 'received'
      else 'none'
    end
  from q
  join public.profiles p on p.id <> auth.uid()
  join auth.users u on u.id = p.id
  left join lateral (
    select ac.id
    from public.aion2_characters ac
    where ac.user_id = p.id
    order by ac.is_primary desc, ac.synced_at desc
    limit 1
  ) representative_character on true
  left join lateral (
    select *
    from public.friend_requests request
    where (request.sender_id = auth.uid() and request.receiver_id = p.id)
       or (request.sender_id = p.id and request.receiver_id = auth.uid())
    order by request.created_at desc
    limit 1
  ) fr on true
  where length(q.value) >= 2
    and (
      p.nickname ilike '%' || q.value || '%'
      or lower(u.email) = lower(q.value)
    )
  order by
    (lower(u.email) = lower(q.value)) desc,
    p.nickname asc
  limit 10;
$$;
