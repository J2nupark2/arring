-- Store the normalized official AION2 character detail payload gathered from
-- info, equipment, equipment/item, and daevanion/detail endpoints.

alter table public.aion2_characters
  add column if not exists detail_data jsonb not null default '{}'::jsonb;
