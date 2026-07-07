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
import { formatCombatPower } from "@/lib/format";
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
      "id, character_id, character_name, server_id, server_name, class_name, character_level, combat_power, proficiency_score, equipment, skills, stigmas, is_primary, synced_at, created_at",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!character) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("manner_temperature, trust_temperature")
    .eq("id", user.id)
    .single();

  const equipment = normalizeList(character.equipment);
  const skills = normalizeList(character.skills);
  const stigmas = normalizeList(character.stigmas);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
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
            <Info label="투력" value={formatCombatPower(character.combat_power)} />
            <Info
              label="매너 온도"
              value={`${Number(profile?.manner_temperature ?? 36.5).toFixed(1)}°`}
            />
            <Info
              label="숙련 점수"
              value={`${Number(character.proficiency_score ?? 36.5).toFixed(1)}점`}
            />
            <Info
              label="신뢰 온도"
              value={`${Number(profile?.trust_temperature ?? 36.5).toFixed(1)}°`}
            />
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

        <div className="grid gap-6 lg:grid-cols-3">
          <DetailSection title="장착 아이템" items={equipment} empty="아직 장착 아이템 정보를 가져오지 못했습니다." />
          <DetailSection title="스킬" items={skills} empty="아직 스킬 정보를 가져오지 못했습니다." />
          <DetailSection title="스티그마" items={stigmas} empty="아직 스티그마 정보를 가져오지 못했습니다." />
        </div>

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

type DetailItem = {
  name: string;
  level?: string | number;
  grade?: string | number;
  slot?: string | number;
  value?: string | number;
};

function normalizeList(value: unknown): DetailItem[] {
  if (!Array.isArray(value)) return [];
  const items: DetailItem[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      items.push({ name: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = record.name ?? record.itemName ?? record.skillName ?? record.stigmaName;
    if (typeof name !== "string" || !name.trim()) continue;
    items.push({
      name,
      level: asText(record.level ?? record.enchantLevel ?? record.skillLevel),
      grade: asText(record.grade ?? record.rarity),
      slot: asText(record.slot ?? record.part),
      value: asText(record.value ?? record.power),
    });
  }
  return items;
}

function asText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function DetailSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: DetailItem[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="rounded-md border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{item.name}</span>
              {item.level !== undefined && (
                <Badge variant="secondary">Lv.{item.level}</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {item.slot && <span>{item.slot}</span>}
              {item.grade && <span>{item.grade}</span>}
              {item.value !== undefined && <span>{item.value}</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
