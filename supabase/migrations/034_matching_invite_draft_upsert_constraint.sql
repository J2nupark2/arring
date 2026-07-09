drop index if exists public.matching_invites_draft_receiver_unique;

alter table public.matching_invites
  drop constraint if exists matching_invites_draft_receiver_key;

alter table public.matching_invites
  add constraint matching_invites_draft_receiver_key
  unique (sender_id, draft_id, receiver_id);
