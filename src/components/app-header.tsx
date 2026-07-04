"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FriendListContent } from "@/components/friends/friend-list-content";

// Shared top navigation for authenticated pages. When showFriends is set,
// a Users button appears below the lg breakpoint (where FriendSidebar is
// hidden) and opens the same friend list content in a slide-over Sheet.
export function AppHeader({
  showFriends = false,
  isGuest = false,
}: {
  showFriends?: boolean;
  isGuest?: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link
          href="/dashboard"
          className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-lg font-bold tracking-tight text-transparent"
        >
          Arring
        </Link>
        <nav aria-label="주 메뉴" className="flex items-center gap-2 sm:gap-3">
          <LinkButton href="/party" variant="ghost">
            파티 구하기
          </LinkButton>
          {showFriends && (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="친구 목록 열기"
                >
                  <Users className="size-4.5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex flex-col p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>친구 목록</SheetTitle>
                </SheetHeader>
                <FriendListContent isGuest={isGuest} />
              </SheetContent>
            </Sheet>
          )}
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
