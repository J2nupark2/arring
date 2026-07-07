-- Expose each friend's primary/most recently synced AION2 character summary
-- through list_friends() so party leaders can place friends into matching
-- composition slots before filling the remaining slots automatically.

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
    friend_character.class_name,
    friend_character.combat_power
  from public.friend_requests fr
  join public.profiles other
    on other.id = case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end
  left join lateral (
    select ac.class_name, ac.combat_power
    from public.aion2_characters ac
    where ac.user_id = other.id
    order by ac.is_primary desc, ac.synced_at desc
    limit 1
  ) friend_character on true
  where fr.status = 'accepted'
    and (fr.sender_id = auth.uid() or fr.receiver_id = auth.uid())
  order by fr.responded_at desc;
$$;
