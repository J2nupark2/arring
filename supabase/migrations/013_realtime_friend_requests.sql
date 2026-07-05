-- Friend request/message badges were poll-only (piggybacked on the 15s
-- friend-list poll). Room invites got their own realtime subscription
-- since a call invite is time-sensitive; on reflection there's no reason
-- friend requests and messages should feel slower — direct_messages
-- already has realtime enabled (migration 011), this just adds
-- friend_requests to the same publication so both can go instant too.
-- Run in Supabase Dashboard > SQL Editor.

alter publication supabase_realtime add table public.friend_requests;
