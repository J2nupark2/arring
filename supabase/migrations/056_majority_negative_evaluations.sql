-- Prevent one malicious player from lowering another player's public scores.
-- Positive evaluations still apply immediately, but negative trust/manner
-- events are emitted only when a weighted majority of the party evaluates the
-- same target negatively. If the leader invited friends before filling the
-- rest through matching, those original premade members count as lower-quality
-- evaluators with 0.5 weight.

create or replace function public.evaluation_participant_weight(
  target_room_id uuid,
  evaluator_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with latest_request as (
    select leader_id, invited_friend_ids
    from public.match_requests
    where room_id = target_room_id
    order by matched_at desc nulls last, created_at desc
    limit 1
  )
  select case
    when exists (
      select 1
      from latest_request lr
      where coalesce(array_length(lr.invited_friend_ids, 1), 0) > 0
        and (
          lr.leader_id = evaluator_id
          or evaluator_id = any(lr.invited_friend_ids)
        )
    ) then 0.5::numeric
    else 1::numeric
  end;
$$;

create or replace function public.rebuild_party_evaluation_score_events(
  target_room_id uuid,
  target_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  eligible_evaluator_count integer;
  negative_trust_weight numeric;
  negative_manner_weight numeric;
  trust_negative_applies boolean;
  manner_negative_applies boolean;
begin
  select count(distinct rp.user_id)
  into eligible_evaluator_count
  from public.room_participants rp
  where rp.room_id = target_room_id
    and rp.user_id <> target_profile_id;

  eligible_evaluator_count := greatest(coalesce(eligible_evaluator_count, 0), 1);

  select coalesce(sum(public.evaluation_participant_weight(target_room_id, pe.evaluator_user_id)), 0)
  into negative_trust_weight
  from public.party_evaluations pe
  where pe.party_id = target_room_id
    and pe.target_user_id = target_profile_id
    and (
      pe.gimmick_review = 'not_mastered'
      or pe.report_reason = 'false_progress'
    );

  select coalesce(sum(public.evaluation_participant_weight(target_room_id, pe.evaluator_user_id)), 0)
  into negative_manner_weight
  from public.party_evaluations pe
  where pe.party_id = target_room_id
    and pe.target_user_id = target_profile_id
    and (
      pe.manner_review = 'bad'
      or pe.report_reason in ('abusive_chat', 'intentional_disruption', 'early_leave')
    );

  trust_negative_applies := negative_trust_weight > (eligible_evaluator_count::numeric / 2);
  manner_negative_applies := negative_manner_weight > (eligible_evaluator_count::numeric / 2);

  delete from public.player_score_events pse
  using public.party_evaluations pe
  where pse.source_evaluation_id = pe.id
    and pe.party_id = target_room_id
    and pe.target_user_id = target_profile_id;

  insert into public.player_score_events (
    user_id, party_id, content_id, gimmick_stage, score_type,
    event_type, event_value, source_evaluation_id
  )
  select
    pe.target_user_id,
    pe.party_id,
    pe.content_id,
    pe.gimmick_stage,
    'trust',
    'positive_gimmick_review',
    greatest(
      -5,
      least(5, 2.0 * pe.weight * public.evaluation_participant_weight(pe.party_id, pe.evaluator_user_id))
    ),
    pe.id
  from public.party_evaluations pe
  where pe.party_id = target_room_id
    and pe.target_user_id = target_profile_id
    and pe.content_id is not null
    and pe.gimmick_review = 'mastered';

  if trust_negative_applies then
    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    select
      pe.target_user_id,
      pe.party_id,
      pe.content_id,
      pe.gimmick_stage,
      'trust',
      'negative_gimmick_review',
      greatest(
        -5,
        least(5, -4.0 * pe.weight * public.evaluation_participant_weight(pe.party_id, pe.evaluator_user_id))
      ),
      pe.id
    from public.party_evaluations pe
    where pe.party_id = target_room_id
      and pe.target_user_id = target_profile_id
      and pe.content_id is not null
      and pe.gimmick_review = 'not_mastered';

    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    select
      pe.target_user_id,
      pe.party_id,
      pe.content_id,
      pe.gimmick_stage,
      'trust',
      'false_progress_report',
      greatest(
        -5,
        least(5, -5.0 * pe.weight * public.evaluation_participant_weight(pe.party_id, pe.evaluator_user_id))
      ),
      pe.id
    from public.party_evaluations pe
    where pe.party_id = target_room_id
      and pe.target_user_id = target_profile_id
      and pe.content_id is not null
      and pe.report_reason = 'false_progress';
  end if;

  insert into public.player_score_events (
    user_id, party_id, content_id, gimmick_stage, score_type,
    event_type, event_value, source_evaluation_id
  )
  select
    pe.target_user_id,
    pe.party_id,
    pe.content_id,
    pe.gimmick_stage,
    'manner',
    'positive_manner_review',
    greatest(
      -5,
      least(5, 2.0 * pe.weight * public.evaluation_participant_weight(pe.party_id, pe.evaluator_user_id))
    ),
    pe.id
  from public.party_evaluations pe
  where pe.party_id = target_room_id
    and pe.target_user_id = target_profile_id
    and pe.manner_review = 'good';

  if manner_negative_applies then
    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    select
      pe.target_user_id,
      pe.party_id,
      pe.content_id,
      pe.gimmick_stage,
      'manner',
      'negative_manner_review',
      greatest(
        -5,
        least(5, -4.0 * pe.weight * public.evaluation_participant_weight(pe.party_id, pe.evaluator_user_id))
      ),
      pe.id
    from public.party_evaluations pe
    where pe.party_id = target_room_id
      and pe.target_user_id = target_profile_id
      and pe.manner_review = 'bad';

    insert into public.player_score_events (
      user_id, party_id, content_id, gimmick_stage, score_type,
      event_type, event_value, source_evaluation_id
    )
    select
      pe.target_user_id,
      pe.party_id,
      pe.content_id,
      pe.gimmick_stage,
      'manner',
      pe.report_reason || '_report',
      greatest(
        -5,
        least(5, -5.0 * pe.weight * public.evaluation_participant_weight(pe.party_id, pe.evaluator_user_id))
      ),
      pe.id
    from public.party_evaluations pe
    where pe.party_id = target_room_id
      and pe.target_user_id = target_profile_id
      and pe.report_reason in ('abusive_chat', 'intentional_disruption', 'early_leave');
  end if;
end;
$$;

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

  insert into public.party_evaluations (
    party_id, evaluator_user_id, target_user_id, content_id, gimmick_stage,
    gimmick_review, manner_review, report_reason, weight, applied_at
  )
  values (
    target_room_id, me, target_profile_id, content_id, stage,
    p_gimmick_review, p_manner_review, p_report_reason, review_weight, now()
  )
  on conflict on constraint party_evaluations_evaluator_target_unique
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

  perform public.rebuild_party_evaluation_score_events(target_room_id, target_profile_id);
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

revoke all on function public.evaluation_participant_weight(uuid, uuid) from public;
revoke all on function public.evaluation_participant_weight(uuid, uuid) from anon, authenticated;
revoke all on function public.rebuild_party_evaluation_score_events(uuid, uuid) from public;
revoke all on function public.rebuild_party_evaluation_score_events(uuid, uuid) from anon, authenticated;
grant execute on function public.submit_party_evaluation(uuid, uuid, text, text, text) to authenticated;
