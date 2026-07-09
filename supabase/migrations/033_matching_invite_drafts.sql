alter table public.matching_invites
  alter column match_request_id drop not null,
  add column if not exists draft_id text,
  add column if not exists dungeon_id uuid references public.dungeons (id) on delete set null,
  add column if not exists required_stage integer,
  add column if not exists min_combat_power integer,
  add column if not exists max_members integer,
  add column if not exists character_row_id uuid references public.aion2_characters (id) on delete set null,
  add column if not exists required_classes text[] not null default '{}';

create index if not exists matching_invites_draft_sender_idx
  on public.matching_invites (sender_id, draft_id, status)
  where draft_id is not null;

alter table public.matching_invites
  drop constraint if exists matching_invites_match_request_id_receiver_id_key;

create unique index if not exists matching_invites_request_receiver_unique
  on public.matching_invites (match_request_id, receiver_id)
  where match_request_id is not null;

create unique index if not exists matching_invites_draft_receiver_unique
  on public.matching_invites (sender_id, draft_id, receiver_id)
  where draft_id is not null;

alter table public.matching_invites
  drop constraint if exists matching_invites_request_or_draft_chk;

alter table public.matching_invites
  add constraint matching_invites_request_or_draft_chk
  check (match_request_id is not null or draft_id is not null);
