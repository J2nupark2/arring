"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
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

  return (
    <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link
          href="/party"
          className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-lg font-bold tracking-tight text-transparent"
        >
          Arring
        </Link>
        <nav aria-label="주 메뉴" className="flex items-center gap-2 sm:gap-3">
          <CharacterSearchDialog />
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
            title="파티 구하기"
          >
            <Link href="/party" aria-label="파티 구하기">
              <Swords className="size-4.5" />
            </Link>
          </Button>
          <LinkButton href="/party" variant="ghost" className="hidden sm:inline-flex">
            파티 구하기
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
