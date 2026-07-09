import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "서비스 소개",
  description:
    "Arring은 아이온2 파티 자동매칭에서 전투력, 기믹 진도, 클래스 조합, 플레이어 평가를 활용하는 방식입니다.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm font-medium text-violet-300">
        Arring
      </Link>
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">아이온2 파티 매칭을 더 투명하게</h1>
        <p className="leading-7 text-muted-foreground">
          Arring은 아이온2 유저가 원정, 초월, 성역 파티를 찾을 때 반복해서 겪는
          조건 확인, 진도 확인, 클래스 조합 조율을 줄이기 위해 만든 파티 자동매칭
          서비스입니다. 파티장은 원하는 조합과 최소 조건을 설정하고, 파티원은
          연동한 캐릭터의 진도와 역할에 맞춰 대기열에 참여합니다.
        </p>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-md border p-4">
          <h2 className="font-semibold">조건을 완화하지 않는 핵심 매칭</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            기믹 단계와 필수 클래스 구성은 파티장이 정한 기준을 지키는 것을
            우선합니다. 전투력은 최소 조건 이상을 기준으로 하되, 가능하면 비슷한
            전투력의 유저끼리 연결되도록 설계합니다.
          </p>
        </article>
        <article className="rounded-md border p-4">
          <h2 className="font-semibold">플레이 기록과 평가</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            매칭 후 평가는 파티 안전망을 높이기 위한 참고 자료입니다. 매너 점수와
            신뢰 점수는 이후 매칭 품질을 높이는 신호로 사용됩니다.
          </p>
        </article>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">운영 원칙</h2>
        <p className="leading-7 text-muted-foreground">
          Arring은 특정 게임사의 공식 서비스가 아니며, 아이온2 유저 커뮤니티의
          파티 구성을 돕는 독립 서비스입니다. 부정확한 캐릭터 정보, 허위 진도,
          비매너 플레이 신고는 평가와 기록 기능을 통해 줄여나가는 것을 목표로 합니다.
        </p>
      </section>
    </main>
  );
}
