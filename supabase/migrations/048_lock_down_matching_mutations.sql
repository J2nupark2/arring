-- Matching state is mutated only through server-side API routes. Prevent an
-- authenticated browser client from bypassing validation with direct writes.
drop policy if exists "leaders can create match requests" on public.match_requests;
drop policy if exists "leaders can cancel own match requests" on public.match_requests;
drop policy if exists "users can join queue" on public.match_queue;
drop policy if exists "users can update own queue" on public.match_queue;

revoke insert, update, delete on public.match_requests from authenticated;
revoke insert, update, delete on public.match_queue from authenticated;

-- The legacy review table no longer drives scores. Keep historical rows
-- private to involved users and block new writes outside the current RPC.
drop policy if exists "reviews visible to authenticated" on public.party_reviews;
drop policy if exists "participants can review matched party members" on public.party_reviews;

create policy "legacy reviews visible to involved users"
  on public.party_reviews for select
  to authenticated
  using (reviewer_id = auth.uid() or reviewed_id = auth.uid());

revoke insert, update, delete on public.party_reviews from authenticated;
