-- Multiple Aion2 characters per user and per-match character selection.
-- Existing profile columns remain as the user's primary character snapshot.

create table public.aion2_characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id text not null,
  character_name text not null,
  server_id integer not null,
  server_name text not null,
  class_name text not null,
  character_level integer not null default 0,
  combat_power integer not null default 0,
  is_primary boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, character_id, server_id)
);

create index aion2_characters_user_idx
  on public.aion2_characters (user_id, is_primary desc, synced_at desc);

alter table public.aion2_characters enable row level security;

create policy "characters viewable by authenticated"
  on public.aion2_characters for select
  to authenticated
  using (true);

create policy "users can manage own characters"
  on public.aion2_characters for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.aion2_characters to authenticated;

insert into public.aion2_characters (
  user_id,
  character_id,
  character_name,
  server_id,
  server_name,
  class_name,
  combat_power,
  is_primary,
  synced_at
)
select
  id,
  aion2_character_id,
  aion2_character_name,
  aion2_server_id,
  server,
  char_class,
  combat_power,
  true,
  coalesce(aion2_synced_at, now())
from public.profiles
where aion2_character_id is not null
  and aion2_character_name is not null
  and aion2_server_id is not null
  and server is not null
  and char_class is not null
  and combat_power is not null
on conflict (user_id, character_id, server_id) do nothing;

alter table public.match_requests
  add column if not exists character_row_id uuid references public.aion2_characters (id) on delete set null;

alter table public.match_queue
  add column if not exists character_row_id uuid references public.aion2_characters (id) on delete set null;
