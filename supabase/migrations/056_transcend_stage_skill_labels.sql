-- Superseded the confirmed boss-pattern gimmick_stages for the three 초월
-- dungeons (originally seeded in 054) with a difficulty-stage x skill-level
-- labeling scheme, applied directly via /admin on 2026-07-16. Recorded here
-- so a fresh database setup matches the live data.
--
-- The 크로메데의 초대/출혈 관리/etc. boss-pattern labels from 054 are
-- intentionally not preserved elsewhere — this is a deliberate content
-- decision, not an accidental overwrite.

update public.dungeons
set gimmick_stages = array[
  '1단계 반숙', '1단계 빡숙', '1단계 재도전',
  '2단계 반숙', '2단계 빡숙', '2단계 재도전',
  '3단계 반숙', '3단계 빡숙', '3단계 재도전',
  '4단계 반숙', '4단계 빡숙', '4단계 재도전'
]
where category = '초월'
  and name in ('가라앉은 생명의 신전', '붉은 연심의 거울', '심연의 뿔 암굴');
