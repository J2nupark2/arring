import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "이용약관",
  description: "Arring 서비스 이용 조건, 사용자 책임, 금지 행위 안내입니다.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm font-medium text-violet-300">Arring</Link>
      <h1 className="text-3xl font-bold tracking-tight">이용약관</h1>
      <p className="text-sm text-muted-foreground">시행일: 2026년 7월 9일</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">서비스 목적</h2>
        <p className="leading-7 text-muted-foreground">
          Arring은 아이온2 유저가 파티를 찾고, 친구를 초대하고, 매칭 기록을 관리할
          수 있도록 돕는 커뮤니티 기반 웹 서비스입니다.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">사용자 책임</h2>
        <p className="leading-7 text-muted-foreground">
          사용자는 자신의 캐릭터 정보, 기믹 진도, 파티 참여 의사를 정확하게 입력해야
          합니다. 허위 정보, 욕설, 괴롭힘, 부정 이용, 타인의 계정 또는 정보를 침해하는
          행위는 제한될 수 있습니다.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">평가와 신고</h2>
        <p className="leading-7 text-muted-foreground">
          매칭 후 평가는 파티 품질을 높이기 위한 참고 자료입니다. 악의적인 허위 평가나
          반복적인 신고 남용은 제한될 수 있습니다.
        </p>
      </section>
    </main>
  );
}
