-- Official-site character link: char_class/combat_power now come from
-- aion2.plaync.com (fetched server-side), so the client-side UPDATE grant
-- from migration 014 is revoked — otherwise users could fake their combat
-- power. Only the /api/aion2/link route (service role) writes these.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.profiles
  add column if not exists aion2_character_id text,
  add column if not exists aion2_character_name text,
  add column if not exists aion2_server_id integer,
  add column if not exists aion2_synced_at timestamptz;

grant select (aion2_character_id, aion2_character_name, aion2_server_id, aion2_synced_at)
  on public.profiles to authenticated;

revoke update on public.profiles from authenticated, anon;
grant update (nickname, server) on public.profiles to authenticated;
