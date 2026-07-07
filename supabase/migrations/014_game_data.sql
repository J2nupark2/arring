-- Foundations for Aion2 auto party matching:
--   - profiles gains game fields (class, combat power) and an is_admin flag
--   - dungeons: admin-managed content list (원정/초월/성역) with per-dungeon
--     gimmick progress stages, editable from the /admin page
--   - dungeon_progress: each user's self-declared progress per dungeon
-- Run in Supabase Dashboard > SQL Editor.
--
-- After running, grant yourself admin (replace the email):
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = '본인이메일@...');

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists char_class text,
  add column if not exists combat_power integer;

-- The narrow column re-grant from migration 010 didn't include these.
grant select (is_admin, char_class, combat_power) on public.profiles to authenticated;

-- Same table-grant trap as password_hash/current_room_code before: the
-- default table-level UPDATE grant would let any user set is_admin=true on
-- their own row (RLS only restricts WHICH rows, not which columns).
-- Narrow it to the columns users may legitimately edit themselves.
revoke update on public.profiles from authenticated, anon;
grant update (nickname, server, char_class, combat_power) on public.profiles to authenticated;

-- SECURITY DEFINER so RLS policies below can check adminship without
-- tripping over profiles' column-level SELECT grants.
create function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- dungeons -----------------------------------------------------------------

create table public.dungeons (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('원정', '초월', '성역')),
  name text not null,
  -- Ordered gimmick progress stages, e.g. {'1넴','2넴','막넴 경험','클리어'}.
  -- A user's dungeon_progress.stage is an index into this array (0 = none).
  gimmick_stages text[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.dungeons enable row level security;

create policy "dungeons viewable by authenticated"
  on public.dungeons for select
  to authenticated
  using (true);

create policy "admins can insert dungeons"
  on public.dungeons for insert
  to authenticated
  with check (public.is_admin());

create policy "admins can update dungeons"
  on public.dungeons for update
  to authenticated
  using (public.is_admin());

create policy "admins can delete dungeons"
  on public.dungeons for delete
  to authenticated
  using (public.is_admin());

-- dungeon_progress ----------------------------------------------------------
-- Self-declared: "stage" counts how many of the dungeon's gimmick_stages the
-- user claims to have cleared (0 = 없음 .. array length = 전부). Honesty is
-- enforced socially via the manner-temperature system, not technically.

create table public.dungeon_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  dungeon_id uuid not null references public.dungeons (id) on delete cascade,
  stage integer not null default 0 check (stage >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, dungeon_id)
);

alter table public.dungeon_progress enable row level security;

-- Progress is intentionally readable by all signed-in users: party leaders
-- need to see applicants' declared progress to accept/reject them.
create policy "progress viewable by authenticated"
  on public.dungeon_progress for select
  to authenticated
  using (true);

create policy "users can declare own progress"
  on public.dungeon_progress for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can update own progress"
  on public.dungeon_progress for update
  to authenticated
  using (user_id = auth.uid());

create policy "users can delete own progress"
  on public.dungeon_progress for delete
  to authenticated
  using (user_id = auth.uid());
