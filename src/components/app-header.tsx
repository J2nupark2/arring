"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LogIn,
  MessageCircle,
  ShieldCheck,
  Swords,
  UserRound,
  Users,
} from "lucide-react";
import { CharacterSearchDialog } from "@/components/character-search-dialog";
import { FriendListContent } from "@/components/friends/friend-list-content";
import { useFriendsContext } from "@/components/friends/friends-provider";
import { LinkButton } from "@/components/link-button";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const VISITED_ROOM_STORAGE_KEY = "arring:visited-room-code";

async function findReturnableRoomCode(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  candidates: (string | null | undefined)[],
) {
  const seen = new Set<string>();
  for (const rawCode of candidates) {
    const code = rawCode?.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const { data: room } = await supabase
      .from("rooms")
      .select("id, code, status, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (
      !room ||
      room.status === "ended" ||
      new Date(room.expires_at).getTime() < Date.now()
    ) {
      continue;
    }

    const { data: participant } = await supabase
      .from("room_participants")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .is("left_at", null)
      .limit(1)
      .maybeSingle();

    if (participant) return room.code;
  }

  return null;
}

// Shared navigation for public and authenticated pages.
export function AppHeader({
  showFriends = false,
  isGuest = false,
  currentRoomCode,
}: {
  showFriends?: boolean;
  isGuest?: boolean;
  currentRoomCode?: string;
}) {
  const { incoming } = useFriendsContext();
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (isGuest) return;

    let active = true;
    const supabase = createClient();

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.is_anonymous) return;

      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();

      if (active) setIsAdmin(data?.is_admin === true);
    })();

    return () => {
      active = false;
    };
  }, [isGuest]);

  useEffect(() => {
    if (isGuest) return;

    let active = true;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const storedRoomCode = window.sessionStorage.getItem(VISITED_ROOM_STORAGE_KEY);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active || !user || user.is_anonymous) return;

      const { data } = await supabase
        .from("profiles")
        .select("current_room_code")
        .eq("id", user.id)
        .maybeSingle();

      const returnableRoomCode = await findReturnableRoomCode(supabase, user.id, [
        data?.current_room_code,
        storedRoomCode,
      ]);

      if (!returnableRoomCode) {
        window.sessionStorage.removeItem(VISITED_ROOM_STORAGE_KEY);
      }

      if (active) setActiveRoomCode(returnableRoomCode);

      channel = supabase
        .channel(`profile-current-room-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          (payload) => {
            const next = payload.new as { current_room_code?: string | null };
            void findReturnableRoomCode(supabase, user.id, [
              next.current_room_code,
            ]).then((returnableRoomCode) => {
              if (!returnableRoomCode) {
                window.sessionStorage.removeItem(VISITED_ROOM_STORAGE_KEY);
              }
              setActiveRoomCode(returnableRoomCode);
            });
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [isGuest]);

  const returnRoomCode = activeRoomCode ?? currentRoomCode ?? null;
  const isViewingActiveRoom =
    !!returnRoomCode && pathname === `/room/${returnRoomCode}`;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card/92 shadow-[0_10px_35px_rgba(0,0,0,.18)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-1 px-3 py-3 sm:gap-2 sm:px-6">
        <Link
          href="/party"
          className="arring-wordmark text-lg"
        >
          Arring
        </Link>
        <nav aria-label="주 메뉴" className="flex items-center gap-0.5 sm:gap-3 [&_[data-size=icon]]:size-7 sm:[&_[data-size=icon]]:size-8">
          <CharacterSearchDialog />
          {!isGuest && returnRoomCode && !isViewingActiveRoom && (
            <>
              <Button
                variant="default"
                size="icon"
                className="sm:hidden"
                asChild
                title="통화방 복귀"
              >
                <Link href={`/room/${returnRoomCode}`} aria-label="통화방 복귀">
                  <LogIn className="size-4.5" />
                </Link>
              </Button>
              <LinkButton
                href={`/room/${returnRoomCode}`}
                variant="default"
                className="hidden sm:inline-flex"
              >
                <LogIn className="size-4" />
                통화방 복귀
              </LinkButton>
            </>
          )}
          <Button variant="ghost" size="icon" asChild title="문의">
            <Link href="/contact" aria-label="문의">
              <MessageCircle className="size-4.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            asChild
            title="매치 메이킹"
          >
            <Link href="/party" aria-label="매치 메이킹">
              <Swords className="size-4.5" />
            </Link>
          </Button>
          <LinkButton href="/party" variant="ghost" className="hidden sm:inline-flex">
            매치 메이킹
          </LinkButton>
          {!isGuest && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden"
                asChild
                title="내 프로필"
              >
                <Link href="/profile" aria-label="내 프로필">
                  <UserRound className="size-4.5" />
                </Link>
              </Button>
              <LinkButton
                href="/profile"
                variant="ghost"
                className="hidden sm:inline-flex"
              >
                내 프로필
              </LinkButton>
            </>
          )}
          {!isGuest && isAdmin && (
            <LinkButton href="/admin" variant="ghost">
              <ShieldCheck className="size-4" />
              <span className="hidden sm:inline">관리자</span>
            </LinkButton>
          )}
          {showFriends && !isGuest && (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative lg:hidden"
                  aria-label="친구 목록 열기"
                >
                  <Users className="size-4.5" />
                  {incoming.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex flex-col p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>친구 목록</SheetTitle>
                </SheetHeader>
                <FriendListContent
                  isGuest={isGuest}
                  currentRoomCode={currentRoomCode}
                />
              </SheetContent>
            </Sheet>
          )}
          {isGuest ? (
            <>
              <LinkButton href="/login" variant="ghost">
                로그인
              </LinkButton>
              <LinkButton href="/signup">회원가입</LinkButton>
            </>
          ) : (
            <LogoutButton />
          )}
        </nav>
      </div>
    </header>
  );
}
