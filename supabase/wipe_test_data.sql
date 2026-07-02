-- Deletes ALL user data: every account, profile, room, and participation
-- record. For wiping test data before launch — do not run once real users
-- exist (unless you mean to).
-- Run in Supabase Dashboard > SQL Editor.
--
-- Order matters: rooms reference profiles without cascade, so clear
-- room data first; deleting auth.users then cascades into profiles.

delete from public.room_participants;
delete from public.rooms;
delete from auth.users;
