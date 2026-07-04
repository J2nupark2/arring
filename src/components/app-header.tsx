import Link from "next/link";
import { LinkButton } from "@/components/link-button";
import { LogoutButton } from "@/components/logout-button";

// Shared top navigation for authenticated pages.
export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link
          href="/dashboard"
          className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-lg font-bold tracking-tight text-transparent"
        >
          Arring
        </Link>
        <nav aria-label="주 메뉴" className="flex items-center gap-1 sm:gap-2">
          <LinkButton href="/party" variant="ghost">
            파티 구하기
          </LinkButton>
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
