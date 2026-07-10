-- Class-specific soul/stone engraving stat priority, curated by admins.
-- We can't compute real DPS efficiency (AION2's damage formula isn't
-- exposed by any API), so this is a qualitative 1-4 tier ranking admins
-- fill in from community theorycrafting, not a calculated value.

create table public.class_stat_priority (
  id uuid primary key default gen_random_uuid(),
  -- One of AION2_CLASSES, or '공통' for the shared fallback used when a
  -- class has no entries of its own yet.
  class_name text not null,
  -- Raw stat id as the official API returns it (WeaponFixingDamage,
  -- Critical, WeaponAccuracy, AmplifyWeaponDamage, MPMax, ...).
  stat_key text not null,
  stat_label text not null,
  tier integer not null check (tier between 1 and 4),
  updated_at timestamptz not null default now(),
  unique (class_name, stat_key)
);

alter table public.class_stat_priority enable row level security;

create policy "priority viewable by authenticated"
  on public.class_stat_priority for select
  to authenticated
  using (true);

create policy "admins can manage priority"
  on public.class_stat_priority for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Generic DPS-role starting point (공격력/치명타 최우선, 명중/피해증폭 차순위,
-- 나머지 생존형은 후순위) sourced from community gearing guides — not
-- tuned per class. Admins should add class-specific rows (수호성/치유성
-- 등은 우선순위가 크게 다름) via /admin.
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
