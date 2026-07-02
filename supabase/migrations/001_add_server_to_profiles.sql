-- Adds the Aion2 server name to profiles.
-- Safe to run on the live DB: no data is dropped.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.profiles
  add column if not exists server text;

-- Store the server from signup metadata alongside the nickname.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nickname, server)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'server', '')
  );
  return new;
end;
$$;
