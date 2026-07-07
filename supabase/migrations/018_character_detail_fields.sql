-- Character detail page fields. Official API coverage can grow over time;
-- store parsed summaries as JSON so UI can show equipment/skills/stigmas
-- without schema churn on every game patch.

alter table public.aion2_characters
  add column if not exists proficiency_score numeric(4,1) not null default 36.5,
  add column if not exists equipment jsonb not null default '[]'::jsonb,
  add column if not exists skills jsonb not null default '[]'::jsonb,
  add column if not exists stigmas jsonb not null default '[]'::jsonb;
