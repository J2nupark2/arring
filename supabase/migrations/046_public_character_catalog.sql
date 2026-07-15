-- Public visitors can browse cached AION2 characters without owning them.
-- User-linked rows remain protected by the existing ownership policy.
alter table public.aion2_characters
  alter column user_id drop not null;

create unique index if not exists aion2_public_character_unique_idx
  on public.aion2_characters (character_id, server_id)
  where user_id is null;

drop policy if exists "active dungeons viewable by anonymous users" on public.dungeons;
create policy "active dungeons viewable by anonymous users"
  on public.dungeons for select
  to anon
  using (is_active = true);

grant select on public.dungeons to anon;
