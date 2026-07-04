import Link from "next/link";
import { UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

// Pure UI for now — friend_requests/friends tables and real actions land
// in a follow-up backend pass. isGuest gates the feature behind an account
// the same way the dashboard banner does.
export function FriendListContent({ isGuest }: { isGuest: boolean }) {
  if (isGuest) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <Users className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          친구 추가는 회원가입 후 이용할 수 있어요.
        </p>
        <Button asChild size="sm">
          <Link href="/signup">회원가입하기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-sm font-semibold">친구 목록</h2>
        <Button variant="ghost" size="icon-sm" disabled aria-label="친구 추가">
          <UserPlus className="size-4" />
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <Users className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">아직 친구가 없어요.</p>
        <p className="text-xs text-muted-foreground">
          같이 통화한 파티원에게 친구 추가를 해보세요. (곧 지원 예정)
        </p>
      </div>
    </div>
  );
}
