-- Room host (방장): kick/transfer moderation and automatic handover.
-- Safe to run on the live DB: no data is dropped.
-- Run in Supabase Dashboard > SQL Editor.

alter table public.rooms
  add column if not exists host_id uuid references public.profiles (id);

update public.rooms set host_id = created_by where host_id is null;
