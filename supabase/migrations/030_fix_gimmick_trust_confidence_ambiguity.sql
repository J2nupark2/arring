-- Fix PL/pgSQL ambiguity between the local confidence variable and the
-- user_gimmick_trust_scores.confidence column.

create or replace function public.recalculate_gimmick_trust_score(
  target_user_id uuid,
  target_content_id uuid,
  target_gimmick_stage integer
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  previous_stage_score numeric(4,1);
  previous_global_score numeric(4,1);
  new_stage_score numeric(4,1);
  new_global_score numeric(4,1);
  event_count integer;
  success_count integer;
  fail_count integer;
  event_delta numeric;
  trust_confidence numeric;
begin
  select score into previous_stage_score
  from public.user_gimmick_trust_scores ugts
  where ugts.user_id = target_user_id
    and ugts.content_id = target_content_id
    and ugts.gimmick_stage = target_gimmick_stage;

  select trust_temperature into previous_global_score
  from public.profiles
  where id = target_user_id;

  with recent_events as (
    select event_type, event_value
    from public.player_score_events pse
    where pse.user_id = target_user_id
      and pse.score_type = 'trust'
      and pse.content_id = target_content_id
      and pse.gimmick_stage = target_gimmick_stage
    order by pse.created_at desc
    limit 10
  )
  select
    count(*),
    count(*) filter (where event_value > 0),
    count(*) filter (where event_value < 0),
    coalesce(sum(event_value), 0)
  into event_count, success_count, fail_count, event_delta
  from recent_events;

  trust_confidence := least(event_count::numeric / 5, 1);
  new_stage_score := public.clamp_player_score(50 + event_delta * trust_confidence);

  insert into public.user_gimmick_trust_scores (
    user_id, content_id, gimmick_stage, score, attempt_count,
    success_count, fail_count, confidence, last_updated_at
  )
  values (
    target_user_id, target_content_id, target_gimmick_stage, new_stage_score,
    event_count, success_count, fail_count, trust_confidence, now()
  )
  on conflict (user_id, content_id, gimmick_stage)
  do update set
    score = excluded.score,
    attempt_count = excluded.attempt_count,
    success_count = excluded.success_count,
    fail_count = excluded.fail_count,
    confidence = excluded.confidence,
    last_updated_at = now();

  select coalesce(
    public.clamp_player_score(
      sum(ugts.score * greatest(ugts.confidence, 0.2)) /
        nullif(sum(greatest(ugts.confidence, 0.2)), 0)
    ),
    50.0
  )
  into new_global_score
  from public.user_gimmick_trust_scores ugts
  where ugts.user_id = target_user_id;

  update public.profiles
  set trust_temperature = new_global_score
  where id = target_user_id;

  if coalesce(previous_stage_score, 50) is distinct from new_stage_score then
    insert into public.score_history (
      user_id, score_type, content_id, gimmick_stage,
      previous_score, new_score, delta, reason
    )
    values (
      target_user_id, 'trust', target_content_id, target_gimmick_stage,
      coalesce(previous_stage_score, 50), new_stage_score,
      new_stage_score - coalesce(previous_stage_score, 50),
      'recent_gimmick_events'
    );
  end if;

  if coalesce(previous_global_score, 50) is distinct from new_global_score then
    insert into public.score_history (
      user_id, score_type, previous_score, new_score, delta, reason
    )
    values (
      target_user_id, 'trust', coalesce(previous_global_score, 50),
      new_global_score, new_global_score - coalesce(previous_global_score, 50),
      'global_gimmick_trust_average'
    );
  end if;
end;
$$;
