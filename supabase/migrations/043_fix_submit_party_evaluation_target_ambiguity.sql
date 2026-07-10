-- Fix runtime ambiguity between the submit_party_evaluation target_user_id
-- argument and party_evaluations/player_score_events target_user_id columns.

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
  target_profile_id uuid := submit_party_evaluation.target_user_id;
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

  if me = target_profile_id then
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
    where room_id = target_room_id and user_id = target_profile_id
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
    and pe.target_user_id = target_profile_id
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
    target_room_id, me, target_profile_id, content_id, stage,
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
      target_profile_id, target_room_id, content_id, stage, 'trust',
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
      target_profile_id, target_room_id, content_id, stage, 'trust',
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
      target_profile_id, target_room_id, content_id, stage, 'manner',
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
      target_profile_id, target_room_id, content_id, stage, 'manner',
      p_report_reason || '_report',
      greatest(-5, least(5, report_manner_value * review_weight)),
      evaluation_id
    );
  end if;

  perform public.recalculate_manner_score(target_profile_id);

  if previous_content_id is not null
    and (previous_content_id is distinct from content_id or previous_stage is distinct from stage) then
    perform public.recalculate_gimmick_trust_score(target_profile_id, previous_content_id, previous_stage);
  end if;

  if content_id is not null then
    perform public.recalculate_gimmick_trust_score(target_profile_id, content_id, stage);
  end if;

  return evaluation_id;
end;
$$;


grant execute on function public.submit_party_evaluation(uuid, uuid, text, text, text) to authenticated;