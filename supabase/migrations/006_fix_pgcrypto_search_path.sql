-- Supabase installs pgcrypto's crypt()/gen_salt() into the `extensions`
-- schema, not `public` — the previous migration's functions couldn't find
-- them. Re-create with `extensions` added to search_path.
-- Run in Supabase Dashboard > SQL Editor.

create or replace function public.create_room(
  p_code text,
  p_title text,
  p_max_members integer,
  p_is_public boolean,
  p_password text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer set search_path = public, extensions
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

create or replace function public.verify_room_password(target_room_id uuid, password text)
returns boolean
language plpgsql
security definer set search_path = public, extensions
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
