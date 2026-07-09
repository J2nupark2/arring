-- Event-based player scoring.
-- Scores start neutral at 50, stay within 1..99, do not decay by time, and
-- are recalculated from the most recent relevant events only.

drop trigger if exists on_party_review_created on public.party_reviews;

create table if not exists public.user_gimmick_trust_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_id uuid references public.dungeons (id) on delete cascade,
  gimmick_stage integer not null default 0 check (gimmick_stage >= 0),
  score numeric(4,1) not null default 50.0 check (score between 1 and 99),
  attempt_count integer not null default 0,
  success_count integer not null default 0,
  fail_count integer not null default 0,
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  last_updated_at timestamptz not null default now(),
  unique (user_id, content_id, gimmick_stage)
);

create table if not exists public.party_evaluations (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.rooms (id) on delete cascade,
  evaluator_user_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  content_id uuid references public.dungeons (id) on delete set null,
  gimmick_stage integer not null default 0 check (gimmick_stage >= 0),
  gimmick_review text not null check (gimmick_review in ('mastered', 'uncertain', 'not_mastered')),
  manner_review text not null check (manner_review in ('good', 'normal', 'bad')),
  report_reason text check (
    report_reason is null
    or report_reason in ('abusive_chat', 'intentional_disruption', 'early_leave', 'false_progress', 'other')
  ),
  weight numeric(5,3) not null default 1 check (weight between 0 and 3),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (party_id, evaluator_user_id, target_user_id),
  check (evaluator_user_id <> target_user_id)
);

create table if not exists public.player_score_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  party_id uuid references public.rooms (id) on delete cascade,
  content_id uuid references public.dungeons (id) on delete cascade,
  gimmick_stage integer not null default 0 check (gimmick_stage >= 0),
  score_type text not null check (score_type in ('manner', 'trust')),
  event_type text not null,
  event_value numeric(4,1) not null check (event_value between -5 and 5),
  source_evaluation_id uuid references public.party_evaluations (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.score_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  score_type text not null check (score_type in ('manner', 'trust')),
  content_id uuid references public.dungeons (id) on delete set null,
  gimmick_stage integer,
  previous_score numeric(4,1) not null,
  new_score numeric(4,1) not null,
  delta numeric(4,1) not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists player_score_events_recent_idx
  on public.player_score_events (user_id, score_type, content_id, gimmick_stage, created_at desc);

create index if not exists party_evaluations_target_idx
  on public.party_evaluations (target_user_id, created_at desc);

alter table public.user_gimmick_trust_scores enable row level security;
alter table public.party_evaluations enable row level security;
alter table public.player_score_events enable row level security;
alter table public.score_history enable row level security;

create policy "gimmick trust scores visible to authenticated"
  on public.user_gimmick_trust_scores for select
  to authenticated
  using (true);

create policy "party evaluations visible to involved users"
  on public.party_evaluations for select
  to authenticated
  using (evaluator_user_id = auth.uid() or target_user_id = auth.uid());

create policy "score events visible to owner"
  on public.player_score_events for select
  to authenticated
  using (user_id = auth.uid());

create policy "score history visible to owner"
  on public.score_history for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.clamp_player_score(value numeric)
returns numeric
language sql
immutable
as $$
  select greatest(1, least(99, round(value, 1)));
$$;

create or replace function public.recalculate_manner_score(target_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  previous_score numeric(4,1);
  new_score numeric(4,1);
  event_count integer;
  event_delta numeric;
  confidence numeric;
begin
  select manner_temperature into previous_score
  from public.profiles
  where id = target_user_id;

  with recent_events as (
    select event_value
    from public.player_score_events
    where user_id = target_user_id
      and score_type = 'manner'
    order by created_at desc
    limit 30
  )
  select count(*), coalesce(sum(event_value), 0)
  into event_count, event_delta
  from recent_events;

  confidence := least(event_count::numeric / 20, 1);
  new_score := public.clamp_player_score(50 + event_delta * confidence);

  update public.profiles
  set manner_temperature = new_score
  where id = target_user_id;

  if previous_score is distinct from new_score then
    insert into public.score_history (
      user_id, score_type, previous_score, new_score, delta, reason
    )
    values (
      target_user_id, 'manner', coalesce(previous_score, 50), new_score,
      new_score - coalesce(previous_score, 50), 'recent_manner_events'
    );
  end if;
end;
$$;

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
  confidence numeric;
begin
  select score into previous_stage_score
  from public.user_gimmick_trust_scores
  where user_id = target_user_id
    and content_id = target_content_id
    and gimmick_stage = target_gimmick_stage;

  select trust_temperature into previous_global_score
  from public.profiles
  where id = target_user_id;

  with recent_events as (
    select event_type, event_value
    from public.player_score_events
    where user_id = target_user_id
      and score_type = 'trust'
      and content_id = target_content_id
      and gimmick_stage = target_gimmick_stage
    order by created_at desc
    limit 10
  )
  select
    count(*),
    count(*) filter (where event_value > 0),
    count(*) filter (where event_value < 0),
    coalesce(sum(event_value), 0)
  into event_count, success_count, fail_count, event_delta
  from recent_events;

  confidence := least(event_count::numeric / 5, 1);
  new_stage_score := public.clamp_player_score(50 + event_delta * confidence);

  insert into public.user_gimmick_trust_scores (
    user_id, content_id, gimmick_stage, score, attempt_count,
    success_count, fail_count, confidence, last_updated_at
  )
  values (
    target_user_id, target_content_id, target_gimmick_stage, new_stage_score,
    event_count, success_count, fail_count, confidence, now()
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
      sum(score * greatest(confidence, 0.2)) / nullif(sum(greatest(confidence, 0.2)), 0)
    ),
    50.0
  )
  into new_global_score
  from public.user_gimmick_trust_scores
  where user_id = target_user_id;

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
  returning id into evaluation_id;

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

  if content_id is not null then
    perform public.recalculate_gimmick_trust_score(target_user_id, content_id, stage);
  end if;

  return evaluation_id;
end;
$$;

grant execute on function public.submit_party_evaluation(uuid, uuid, text, text, text) to authenticated;
