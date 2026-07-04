-- rooms.created_by/host_id had no ON DELETE action, so deleting a user
-- (which cascades auth.users -> profiles) failed whenever they still had
-- rooms on the books. Rooms are ephemeral session data, so cascading their
-- deletion along with the owning profile is the right behavior.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.rooms drop constraint rooms_created_by_fkey;
alter table public.rooms
  add constraint rooms_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete cascade;

alter table public.rooms drop constraint if exists rooms_host_id_fkey;
alter table public.rooms
  add constraint rooms_host_id_fkey
  foreign key (host_id) references public.profiles (id) on delete cascade;

-- Same issue: every room join adds a row here, so this was blocking
-- deletion of essentially any user who had ever joined a room.
alter table public.room_participants drop constraint room_participants_user_id_fkey;
alter table public.room_participants
  add constraint room_participants_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
