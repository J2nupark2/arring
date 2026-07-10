-- Keep one mutable evaluation per evaluator/target pair. If the same players
-- meet again, the evaluator updates the previous evaluation instead of adding
-- another score event.

create temporary table if not exists tmp_affected_evaluation_scores (
  target_user_id uuid not null,
  content_id uuid,
  gimmick_stage integer not null default 0
) on commit drop;

with ranked as (
  select
    id,
    target_user_id,
    content_id,
    gimmick_stage,
    row_number() over (
      partition by evaluator_user_id, target_user_id
      order by applied_at desc nulls last, created_at desc, id desc
    ) as row_number
  from public.party_evaluations
), duplicates as (
  select id, target_user_id, content_id, gimmick_stage
  from ranked
  where row_number > 1
)
insert into tmp_affected_evaluation_scores (target_user_id, content_id, gimmick_stage)
select distinct target_user_id, content_id, coalesce(gimmick_stage, 0)
from duplicates;

with ranked as (
  select
    id,
    row_number() over (
      partition by evaluator_user_id, target_user_id
      order by applied_at desc nulls last, created_at desc, id desc
    ) as row_number
  from public.party_evaluations
), duplicates as (
  select id
  from ranked
  where row_number > 1
)
delete from public.player_score_events pse
using duplicates d
where pse.source_evaluation_id = d.id;

with ranked as (
  select
    id,
    row_number() over (
      partition by evaluator_user_id, target_user_id
      order by applied_at desc nulls last, created_at desc, id desc
    ) as row_number
  from public.party_evaluations
), duplicates as (
  select id
  from ranked
  where row_number > 1
)
delete from public.party_evaluations pe
using duplicates d
where pe.id = d.id;

create unique index if not exists party_evaluations_evaluator_target_key
  on public.party_evaluations (evaluator_user_id, target_user_id);

create or replace function public.submit_party_evaluation(
  target_room_id uuid,
  target_user_id uuid,
  p_gimmick_review text,
  p_manner_review text,
  p_report_reason text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  content_id uuid;
  stage integer;
  evaluation_id uuid;
  previous_content_id uuid;
  previous_stage integer;
  review_weight numeric := 1;
  trust_event_value numeric(4,1) := 0;
  manner_event_value numeric(4,1) := 0;
  report_trust_value numeric(4,1) := 0;
  report_manner_value numeric(4,1) := 0;
begin
  if me is null then
    raise exception 'login required';
  end if;

  if me = target_user_id then
    raise exception 'cannot evaluate yourself';
  end if;

  if p_gimmick_review not in ('mastered', 'uncertain', 'not_mastered') then
    raise exception 'invalid gimmick review';
  end if;

  if p_manner_review not in ('good', 'normal', 'bad') then
    raise exception 'invalid manner review';
  end if;

  if p_report_reason is not null
    and p_report_reason not in ('abusive_chat', 'intentional_disruption', 'early_leave', 'false_progress', 'other') then
    raise exception 'invalid report reason';
  end if;

  if not exists (
    select 1 from public.room_participants
    where room_id = target_room_id and user_id = me
  ) or not exists (
    select 1 from public.room_participants
    where room_id = target_room_id and user_id = target_user_id
  ) then
    raise exception 'only party members can evaluate each other';
  end if;

  select mr.dungeon_id, mr.required_stage
  into content_id, stage
  from public.match_requests mr
  where mr.room_id = target_room_id
  order by mr.matched_at desc nulls last, mr.created_at desc
  limit 1;

  stage := coalesce(stage, 0);

  select pe.id, pe.content_id, pe.gimmick_stage
  into evaluation_id, previous_content_id, previous_stage
  from public.party_evaluations pe
  where pe.evaluator_user_id = me
    and pe.target_user_id = target_user_id
  limit 1;

  previous_stage := coalesce(previous_stage, 0);

  review_weight := case
    when exists (
      select 1 from public.profiles
      where id = me
        and manner_temperature >= 70
        and trust_temperature >= 70
    ) then 1.15
    when exists (
      select 1 from public.profiles
      where id = me
        and (manner_temperature < 30 or trust_temperature < 30)
    ) then 0.75
    else 1
  end;

  trust_event_value := case p_gimmick_review
    when 'mastered' then 2.0
    when 'not_mastered' then -4.0
    else 0
  end;

  manner_event_value := case p_manner_review
    when 'good' then 2.0
    when 'bad' then -4.0
    else 0
  end;

  report_trust_value := case p_report_reason
    when 'false_progress' then -5.0
    else 0
  end;

  report_manner_value := case p_report_reason
    when 'abusive_chat' then -5.0
    when 'intentional_disruption' then -5.0
    when 'early_leave' then -5.0
    else 0
  end;

  insert into public.party_evaluations (
    party_id, evaluator_user_id, target_user_id, content_id, gimmick_stage,
    gimmick_review, manner_review, report_reason, weight, applied_at
  )
  values (
    target_room_id, me, target_user_id, content_id, stage,
    p_gimmick_review, p_manner_review, p_report_reason, review_weight, now()
  )
  on conflict (evaluator_user_id, target_user_id)
  do update set
    party_id = excluded.party_id,
    content_id = excluded.content_id,
    gimmick_stage = excluded.gimmick_stage,
    gimmick_review = excluded.gimmick_review,
    manner_review = excluded.manner_review,
    report_reason = excluded.report_reason,
    weight = excluded.weight,
    applied_at = now()
  returning id into evaluation_id;

  delete from public.player_score_events
  where source_evaluation_id = evaluation_id;

  if content_id is not null and trust_event_value <> 0 then
    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    values (
      target_user_id, target_room_id, content_id, stage, 'trust',
      case when trust_event_value > 0 then 'positive_gimmick_review' else 'negative_gimmick_review' end,
      greatest(-5, least(5, trust_event_value * review_weight)),
      evaluation_id
    );
  end if;

  if content_id is not null and report_trust_value <> 0 then
    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    values (
      target_user_id, target_room_id, content_id, stage, 'trust',
      'false_progress_report',
      greatest(-5, least(5, report_trust_value * review_weight)),
      evaluation_id
    );
  end if;

  if manner_event_value <> 0 then
    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    values (
      target_user_id, target_room_id, content_id, stage, 'manner',
      case when manner_event_value > 0 then 'positive_manner_review' else 'negative_manner_review' end,
      greatest(-5, least(5, manner_event_value * review_weight)),
      evaluation_id
    );
  end if;

  if report_manner_value <> 0 then
    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    values (
      target_user_id, target_room_id, content_id, stage, 'manner',
      p_report_reason || '_report',
      greatest(-5, least(5, report_manner_value * review_weight)),
      evaluation_id
    );
  end if;

  perform public.recalculate_manner_score(target_user_id);

  if previous_content_id is not null
    and (previous_content_id is distinct from content_id or previous_stage is distinct from stage) then
    perform public.recalculate_gimmick_trust_score(target_user_id, previous_content_id, previous_stage);
  end if;

  if content_id is not null then
    perform public.recalculate_gimmick_trust_score(target_user_id, content_id, stage);
  end if;

  return evaluation_id;
end;
$$;

grant execute on function public.submit_party_evaluation(uuid, uuid, text, text, text) to authenticated;

do $$
declare
  affected record;
begin
  for affected in
    select distinct target_user_id, content_id, gimmick_stage
    from tmp_affected_evaluation_scores
  loop
    perform public.recalculate_manner_score(affected.target_user_id);
    if affected.content_id is not null then
      perform public.recalculate_gimmick_trust_score(
        affected.target_user_id,
        affected.content_id,
        affected.gimmick_stage
      );
    end if;
  end loop;
end;
$$;