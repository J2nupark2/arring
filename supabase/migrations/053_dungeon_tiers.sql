alter table public.dungeons
  add column if not exists tier integer not null default 1;

alter table public.dungeons
  add constraint dungeons_tier_range check (tier between 1 and 99);

