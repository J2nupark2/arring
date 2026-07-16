-- Seed the real AION2 dungeon list (as of 2026-07, season 3) into
-- public.dungeons. Removes the placeholder test row created while trying
-- out the admin UI.
--
-- gimmick_stages are only filled in for dungeons whose final-boss pattern
-- order was confirmed via community guides (환영의 회랑, 푸른 숨의 섬,
-- 붉은 연심의 거울, 무스펠의 성배, 타락한 데바의 성, 바크론의 공중섬,
-- 침식의 정화소, 사나운 뿔 암굴, 심연의 뿔 암굴). The rest are seeded with
-- name/category/tier only — add their gimmick stages later from /admin
-- once confirmed, rather than guess at boss pattern names.
--
-- Note: "심연의 뿔 암굴" (초월 4티어) reuses 사나운 뿔 암굴's (원정 3티어)
-- bosses/patterns almost exactly — confirmed via a guide video that says
-- so directly ("원정에 있었던 암굴 거의 그대로") — so it shares the same
-- gimmick_stages array.

delete from public.dungeons where name = '박주형이 똥 싼 변기';

insert into public.dungeons (category, name, tier, sort_order, gimmick_stages) values
  -- 초월
  ('초월', '가라앉은 생명의 신전', 2, 0, '{}'),
  ('초월', '붉은 연심의 거울', 3, 0, array['크로메데의 초대','살고 싶어? 그럼 도망쳐 봐!','사랑의 길','거울 속 진실','나눠 가져 봐. 내가 느낀 이 절망을!']),
  ('초월', '심연의 뿔 암굴', 4, 0, array['출혈 관리','연속 할퀴기','간 빼먹기','분신','파괴의 푸른 빛','붉은 공 3회 던지기']),

  -- 원정
  ('원정', '크라오', 1, 0, '{}'),
  ('원정', '드라웁니르', 1, 1, '{}'),
  ('원정', '우루구구', 2, 0, '{}'),
  ('원정', '바크론의 공중섬', 2, 1, array['바인드','AoE 4회 공격','기암 감옥','3연속 링 소환','줄기 패턴']),
  ('원정', '사나운 뿔 암굴', 3, 0, array['출혈 관리','연속 할퀴기','간 빼먹기','분신','파괴의 푸른 빛','붉은 공 3회 던지기']),
  ('원정', '불의 신전', 3, 1, '{}'),
  ('원정', '무의 요람', 4, 0, '{}'),
  ('원정', '드라마타', 4, 1, '{}'),
  ('원정', '푸른 숨의 섬', 5, 0, array['벼락 구체 관리','천둥 질주','푸른 크리스탈']),
  ('원정', '환영의 회랑', 5, 1, array['레이저','절멸의 빛','분열된 환영','동시 처치']),
  ('원정', '타락한 데바의 성', 6, 0, array['침식&시련','검과 방패의 빛. 하나가 되어야만 한다','침식과 시련이 뒤섞인다. 너의 운명은 어디에 있나?','심판의 폭발']),

  -- 성역
  ('성역', '심연의 재련: 루드라', 1, 0, '{}'),
  ('성역', '침식의 정화소', 2, 0, array['광역 장판','블랙홀/레이저','만두','광역 장판','던지기 만두','광역 장판','마지막 만두']),
  ('성역', '무스펠의 성배', 3, 0, array['신호등','날개','2신호등','산모산','파도']);
