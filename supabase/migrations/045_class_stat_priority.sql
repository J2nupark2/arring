-- Admin-curated class-specific stat priority for character detail option
-- hints. This is qualitative guidance, not a calculated DPS formula.

create table if not exists public.class_stat_priority (
  id uuid primary key default gen_random_uuid(),
  class_name text not null,
  stat_key text not null,
  stat_label text not null,
  tier integer not null check (tier between 1 and 4),
  updated_at timestamptz not null default now(),
  unique (class_name, stat_key)
);

alter table public.class_stat_priority enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'class_stat_priority'
      and policyname = 'priority viewable by authenticated'
  ) then
    create policy "priority viewable by authenticated"
      on public.class_stat_priority for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'class_stat_priority'
      and policyname = 'admins can manage priority'
  ) then
    create policy "admins can manage priority"
      on public.class_stat_priority for all
      to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end;
$$;

insert into public.class_stat_priority (class_name, stat_key, stat_label, tier) values
  ('공통', 'WeaponFixingDamage', '공격력', 1),
  ('공통', 'Critical', '치명타', 1),
  ('공통', 'WeaponAccuracy', '명중', 2),
  ('공통', 'Accuracy', '명중', 2),
  ('공통', 'AmplifyWeaponDamage', '무기 피해 증폭', 2),
  ('공통', 'AmplifyAllDamage', '피해 증폭', 2),
  ('공통', 'AdditionalHitRate', '다단 히트 적중', 3),
  ('공통', 'CombatSpeed', '전투 속도', 3),
  ('공통', 'Block', '막기', 4),
  ('공통', 'HPMax', '생명력', 4),
  ('공통', 'MPMax', '정신력', 4),
  ('공통', 'ArmorDefense', '방어력', 4)
on conflict (class_name, stat_key) do nothing;
