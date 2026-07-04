-- Optional room password. Hash is never exposed to clients: column-level
-- REVOKE blocks direct SELECT of it even though row-level RLS allows
-- reading the room row; only SECURITY DEFINER functions (which run as the
-- table owner) can read/write it.
-- Safe to run on the live DB: no data is dropped.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.rooms add column if not exists password_hash text;
revoke select (password_hash) on public.rooms from authenticated, anon;

-- Replaces the direct client-side insert so a plaintext password can be
-- bcrypt-hashed server-side (via pgcrypto) without a round trip through
-- application code.
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
security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.rooms (code, title, max_members, is_public, created_by, host_id, expires_at, password_hash)
  values (
    p_code, p_title, p_max_members, p_is_public, auth.uid(), auth.uid(), p_expires_at,
    case when p_password is not null and p_password <> '' then crypt(p_password, gen_salt('bf')) else null end
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
security definer set search_path = public
as $$
declare
  hash text;
begin
  select password_hash into hash from public.rooms where id = target_room_id;
  if hash is null then
    return true;
  end if;
  return crypt(coalesce(password, ''), hash) = hash;
end;
$$;

-- Recreated with has_password added to the result columns.
drop function if exists public.list_public_rooms cascade;

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
