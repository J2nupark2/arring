import { AuthNav } from "@/components/auth-nav";
import { LinkButton } from "@/components/link-button";
import { Mic, Users, Swords } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    icon: Mic,
    title: "원클릭 통화방",
    description:
      "링크를 복사하고 붙여넣을 필요 없이, 버튼 하나로 일회용 통화방을 만들고 바로 입장하세요.",
  },
  {
    icon: Users,
    title: "친구 추가 & 재플레이",
    description:
      "함께한 플레이가 마음에 들었다면 통화 종료 후 바로 친구 추가하고, 다음에도 같이 플레이하세요.",
  },
  {
    icon: Swords,
    title: "파티/그룹원 매칭",
    description:
      "모집 중인 파티를 둘러보고 바로 통화방에 입장하거나, 직접 파티를 모집해보세요.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            Arring
          </span>
          <nav className="flex items-center gap-2">
            <AuthNav />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          {/* Ambient glow behind the hero */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-130 w-200 -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]"
          />
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-28 text-center">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-violet-300">
              아이온2 비공식 파티 통화 도구
            </span>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              링크 없이, 한 번에 들어가는
              <br />
              <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                아이온2 던전 통화방
              </span>
            </h1>
            <p className="max-w-xl text-balance text-muted-foreground">
              디스코드 초대 링크를 매번 복사할 필요 없이, 아링에서 바로 일회용
              통화방을 만들고 파티원을 초대하세요.
            </p>
            <div className="flex gap-3">
              <LinkButton
                href="/dashboard"
                size="lg"
                className="shadow-lg shadow-primary/30"
              >
                통화방 만들기
              </LinkButton>
              <LinkButton href="/login" size="lg" variant="outline">
                로그인
              </LinkButton>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-28 sm:grid-cols-3">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="transition-colors hover:ring-primary/40"
            >
              <CardHeader>
                <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/15 text-violet-300">
                  <feature.icon className="size-4.5" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
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
