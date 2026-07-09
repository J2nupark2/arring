import type { Metadata } from "next";
import Link from "next/link";
import { RedirectIfAuthed } from "@/components/redirect-if-authed";

export const metadata: Metadata = {
  title: "아링(Arring) - 아이온2 파티 자동매칭",
  description:
    "아이온2 원정, 초월, 성역 파티를 전투력, 기믹 진도, 클래스 조합, 매너 점수 기준으로 자동 매칭하는 파티 구하기 서비스입니다.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <RedirectIfAuthed to="/party" />
      <main className="flex flex-1 flex-col">
        <section className="border-b">
          <div className="mx-auto flex w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
            <div className="flex flex-col justify-center gap-6">
              <Link
                href="/"
                className="w-fit bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent"
              >
                Arring
              </Link>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
                  아이온2 파티를 조건에 맞게 자동매칭하세요
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                  Arring은 원정, 초월, 성역 파티를 전투력, 기믹 진도, 클래스 조합,
                  매너 점수 기준으로 연결하는 아이온2 파티 구하기 서비스입니다.
                  파티장은 원하는 조합을 정하고, 파티원은 연동한 캐릭터와 진도를
                  선택해 빠르게 매칭을 시작할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/login"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  로그인하고 시작하기
                </Link>
                <Link
                  href="/signup"
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  회원가입
                </Link>
                <Link
                  href="/about"
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  서비스 소개
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3">
          {[
            {
              title: "콘텐츠별 고정 인원",
              body: "원정과 초월은 5명, 성역은 10명 기준으로 파티 구성을 나누어 관리합니다.",
            },
            {
              title: "기믹 진도와 투력 조건",
              body: "파티장이 요구 진도와 최소 전투력을 지정하면 조건을 만족하는 캐릭터만 매칭됩니다.",
            },
            {
              title: "매너와 신뢰 점수",
              body: "매칭 후 평가 기록을 점수로 반영해 더 믿을 수 있는 파티 경험을 돕습니다.",
            },
          ].map((item) => (
            <article key={item.title} className="rounded-md border p-4">
              <h2 className="text-base font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
            </article>
          ))}
        </section>

        <section className="border-t">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-2">
            <article>
              <h2 className="text-xl font-semibold">파티장에게 필요한 기능</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                받을 클래스 조합, 최소 전투력, 요구 기믹 단계, 친구 초대 상태를
                한 화면에서 확인합니다. 초대한 친구가 준비되면 부족한 인원을
                자동매칭으로 채울 수 있습니다.
              </p>
            </article>
            <article>
              <h2 className="text-xl font-semibold">파티원에게 필요한 기능</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                연동한 캐릭터 중 하나를 선택하고 자신의 기믹 진도를 기준으로
                대기열에 참여합니다. 조건에 맞는 파티가 생기면 수락 화면을 통해
                방으로 이동할 수 있습니다.
              </p>
            </article>
          </div>
        </section>

        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
            <span>© 2026 Arring. 아이온2 파티 매칭 커뮤니티.</span>
            <nav className="flex flex-wrap gap-3" aria-label="푸터 메뉴">
              <Link href="/about" className="hover:text-foreground">소개</Link>
              <Link href="/privacy" className="hover:text-foreground">개인정보처리방침</Link>
              <Link href="/terms" className="hover:text-foreground">이용약관</Link>
              <Link href="/contact" className="hover:text-foreground">문의</Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  );
}
