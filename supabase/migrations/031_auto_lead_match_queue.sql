alter table public.match_queue
  add column if not exists queue_role text not null default 'member'
    check (queue_role in ('leader', 'member')),
  add column if not exists can_auto_lead boolean not null default false,
  add column if not exists auto_lead_after_seconds integer not null default 90
    check (auto_lead_after_seconds between 30 and 600),
  add column if not exists auto_lead_eligible_at timestamptz,
  add column if not exists min_power integer not null default 0
    check (min_power >= 0),
  add column if not exists required_gimmick_stage integer,
  add column if not exists allowed_classes text[] not null default '{}',
  add column if not exists required_class_composition text[] not null default '{}',
  add column if not exists allow_condition_relaxation boolean not null default false;

update public.match_queue
  set required_gimmick_stage = requested_stage
  where required_gimmick_stage is null;

create index if not exists match_queue_auto_lead_idx
  on public.match_queue (status, can_auto_lead, auto_lead_eligible_at, dungeon_id)
  where status = 'waiting' and can_auto_lead = true;
