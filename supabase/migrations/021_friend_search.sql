-- Friend search from the friend drawer. Nicknames can be searched
-- partially; emails only match exactly so the app does not expose an
-- email directory.

create or replace function public.search_friend_candidates(search_query text)
returns table (
  user_id uuid,
  nickname text,
  server text,
  email text,
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
