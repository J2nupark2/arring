import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "공지사항",
  description: "Arring 서비스 업데이트와 운영 공지를 확인할 수 있습니다.",
  alternates: { canonical: "/notices" },
};

const noticeSections = [
  {
    title: "부정 평가는 과반 동의 시 반영",
    body:
      "매칭 후 같은 파티에서 대상자를 제외한 평가자 기준으로 과반수가 같은 방향의 부정 평가를 남긴 경우에만 점수에 반영됩니다. 조건을 넘지 못한 부정 평가는 기록은 남지만 점수에는 반영되지 않습니다.",
  },
  {
    title: "기존 파티원 평가는 낮은 가중치로 계산",
    body:
      "방장이 친구를 초대한 뒤 남은 자리를 매칭한 경우, 방장과 초대된 기존 파티원의 평가는 일반 매칭 참여자보다 낮은 가중치로 계산됩니다. 지인끼리의 담합 평가나 보복 평가 가능성을 줄이기 위한 조치입니다.",
  },
  {
    title: "긍정 평가는 기존처럼 반영",
    body:
      "좋은 플레이 경험은 바로 기록될 수 있도록 긍정 평가는 기존처럼 즉시 점수에 반영됩니다.",
  },
  {
    title: "패치 목적",
    body:
      "게임을 제대로 진행하지 않고 부정적인 평가를 남발하는 악성 이용, 지인 파티의 담합 평가, 보복성 평가를 줄이고 실제 플레이 경험에 가까운 신뢰도를 만들기 위한 업데이트입니다.",
  },
];

export default function NoticesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="arring-wordmark text-sm">
          Arring
        </Link>
        <Link
          href="/party"
          className="rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
        >
          매치 메이킹으로 이동
        </Link>
      </div>

      <section className="space-y-3">
        <p className="text-sm font-semibold text-primary">공지사항</p>
        <h1 className="text-3xl font-bold tracking-tight">
          평가 악용 방지 정책이 적용되었습니다
        </h1>
        <p className="leading-7 text-muted-foreground">
          Arring을 통해 매칭된 뒤 오가는 평가가 더 공정하게 반영되도록 평가
          반영 기준을 조정했습니다.
        </p>
      </section>

      <article className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_80px_rgba(0,0,0,.20)]">
        <div className="border-b bg-muted/20 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              평가 시스템
            </span>
            <time className="text-sm text-muted-foreground" dateTime="2026-07-22">
              2026년 7월 22일
            </time>
          </div>
          <h2 className="mt-4 text-2xl font-bold">
            부정 평가 과반 반영 및 기존 파티원 가중치 조정
          </h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            매칭 품질을 해치지 않으면서도 악의적인 평가 남발을 막기 위해,
            부정 평가는 여러 명의 일치된 평가가 있을 때만 점수에 반영됩니다.
          </p>
        </div>

        <div className="grid gap-4 p-5 sm:p-6">
          {noticeSections.map((section) => (
            <section key={section.title} className="rounded-xl border bg-background/45 p-4">
              <h3 className="font-semibold">{section.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
