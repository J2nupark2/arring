import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LinkButton } from "@/components/link-button";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/guest?next=${encodeURIComponent(`/profile/characters/${id}`)}`);
  }

  const { data: character } = await supabase
    .from("aion2_characters")
    .select(
      "id, character_id, character_name, server_id, server_name, class_name, character_level, combat_power, is_primary, synced_at, created_at",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!character) notFound();

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {character.character_name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {character.server_name} 서버 캐릭터 상세
            </p>
          </div>
          <LinkButton href="/profile" variant="outline">
            프로필로
          </LinkButton>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {character.character_name}
              {character.is_primary && <Badge variant="secondary">대표</Badge>}
            </CardTitle>
            <CardDescription>
              공식 홈페이지에서 가져온 최근 캐릭터 정보입니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Info label="서버" value={character.server_name} />
            <Info label="클래스" value={character.class_name} />
            <Info label="레벨" value={`Lv.${character.character_level}`} />
            <Info label="투력" value={character.combat_power.toLocaleString()} />
            <Info
              label="마지막 동기화"
              value={new Date(character.synced_at).toLocaleString("ko-KR")}
            />
            <Info
              label="연동일"
              value={new Date(character.created_at).toLocaleString("ko-KR")}
            />
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          캐릭터 정보가 바뀌었다면{" "}
          <Link href="/profile" className="underline underline-offset-4">
            프로필
          </Link>
          에서 동기화를 눌러주세요.
        </p>
      </main>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
