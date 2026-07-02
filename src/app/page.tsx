import Link from "next/link";
import { AuthNav } from "@/components/auth-nav";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    title: "원클릭 통화방",
    description:
      "링크를 복사하고 붙여넣을 필요 없이, 버튼 하나로 일회용 통화방을 만들고 바로 입장하세요.",
  },
  {
    title: "친구 추가 & 재플레이",
    description:
      "함께한 플레이가 마음에 들었다면 통화 종료 후 바로 친구 추가하고, 다음에도 같이 플레이하세요.",
  },
  {
    title: "파티/그룹원 매칭",
    description: "던전, 시간, 인원을 올리고 신청받는 매칭 게시판을 준비 중입니다.",
    comingSoon: true,
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">Arring</span>
          <nav className="flex items-center gap-2">
            <AuthNav />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-24 text-center">
          <span className="rounded-full border px-3 py-1 text-sm text-muted-foreground">
            아이온2 비공식 파티 통화 도구
          </span>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            링크 없이, 한 번에 들어가는
            <br />
            아이온2 던전 통화방
          </h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            디스코드 초대 링크를 매번 복사할 필요 없이, 아링에서 바로 일회용
            통화방을 만들고 파티원을 초대하세요.
          </p>
          <div className="flex gap-3">
            <Button size="lg" asChild>
              <Link href="/dashboard">통화방 만들기</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">로그인</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 sm:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {feature.title}
                  {feature.comingSoon && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      준비 중
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted-foreground">
          Arring은 아이온2 팬들이 만든 비공식 커뮤니티 도구이며, 엔씨소프트와
          관련이 없습니다.
        </div>
      </footer>
    </div>
  );
}
