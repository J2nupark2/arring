-- 005's "revoke select (password_hash)" had no effect: Postgres already had
-- a table-level SELECT grant (covering all columns) in place, and a
-- column-level REVOKE cannot narrow a broader table-level GRANT — it only
-- undoes privileges that were granted at the column level. Confirmed live:
-- password_hash was readable via a plain REST query.
--
-- Fix: revoke the table-level SELECT entirely and re-grant SELECT on only
-- the non-sensitive columns. RLS row policies still apply on top of this.
-- Run in Supabase Dashboard > SQL Editor.

revoke select on public.rooms from authenticated, anon;

grant select (
  id, code, title, max_members, is_public, created_by, host_id,
  created_at, expires_at, status
) on public.rooms to authenticated;
