-- Keep pre-room friend invitations attached to a waiting match request.
-- When the match later completes, the API creates the room and sends
-- room_invites to these friends while filling only the remaining slots
-- through automatic matching.

alter table public.match_requests
  add column if not exists invited_friend_ids uuid[] not null default '{}'::uuid[];
