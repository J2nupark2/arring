import { FriendListContent } from "@/components/friends/friend-list-content";

// Static right rail shown on large screens; hidden below lg where the
// header's mobile trigger (see app-header.tsx) opens the same content in
// a Sheet instead.
export function FriendSidebar({ isGuest }: { isGuest: boolean }) {
  return (
    <aside className="sticky top-[73px] hidden h-[calc(100vh-73px-2rem)] w-72 shrink-0 flex-col rounded-lg border bg-card/50 lg:flex">
      <FriendListContent isGuest={isGuest} />
    </aside>
  );
}
