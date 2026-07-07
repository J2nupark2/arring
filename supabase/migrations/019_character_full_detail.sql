-- Store the character-info fields the official API already returns but we
-- were discarding: per-god stat block, owned titles, and daevanion board
-- progress. Equipment items themselves gain extra nested fields
-- (mainStats/subStats/magicStoneStat/godStoneStat/set) from the per-item
-- detail endpoint, but that's still the same `equipment` jsonb array so no
-- column change is needed there.

alter table public.aion2_characters
  add column if not exists stat_list jsonb not null default '[]'::jsonb,
  add column if not exists titles jsonb not null default '[]'::jsonb,
  add column if not exists daevanion jsonb not null default '[]'::jsonb;
