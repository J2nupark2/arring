-- Split expedition/sanctum matching content into independently editable
-- normal/hard dungeon rows. Each copied row keeps the original category,
-- tier, gimmick stages, active flag, and gets an adjacent sort order.
--
-- 원정: all existing base rows are copied to "보통" and "어려움".
-- 성역: rows from "무스펠" onward by sort_order are copied. If there is no
--       Muspel anchor in the current data, all sanctuary base rows are copied.

with sanctuary_anchor as (
  select min(sort_order) as sort_order
  from public.dungeons
  where category = '성역'
    and name ilike '%무스펠%'
),
source_dungeons as (
  select d.*
  from public.dungeons d
  cross join sanctuary_anchor anchor
  where d.name !~ '[[:space:]]*(\(|\[)?(보통|어려움)(\)|\])?[[:space:]]*$'
    and (
      d.category = '원정'
      or (
        d.category = '성역'
        and (anchor.sort_order is null or d.sort_order >= anchor.sort_order)
      )
    )
),
difficulty_variants as (
  select
    category,
    name || ' 보통' as name,
    gimmick_stages,
    tier,
    sort_order * 10 as sort_order,
    is_active
  from source_dungeons
  union all
  select
    category,
    name || ' 어려움' as name,
    gimmick_stages,
    tier,
    sort_order * 10 + 1 as sort_order,
    is_active
  from source_dungeons
)
insert into public.dungeons (
  category,
  name,
  gimmick_stages,
  tier,
  sort_order,
  is_active
)
select
  variant.category,
  variant.name,
  variant.gimmick_stages,
  variant.tier,
  variant.sort_order,
  variant.is_active
from difficulty_variants variant
where not exists (
  select 1
  from public.dungeons existing
  where existing.category = variant.category
    and existing.name = variant.name
);
