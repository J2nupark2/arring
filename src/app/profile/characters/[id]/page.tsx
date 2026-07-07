import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ExternalLink,
  Gauge,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCombatPower } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EQUIPMENT_SLOTS = [
  { key: "weapon", label: "무기", aliases: ["무기", "weapon", "mainhand"] },
  { key: "subWeapon", label: "보조", aliases: ["보조", "방패", "sub", "shield", "subhand"] },
  { key: "helmet", label: "투구", aliases: ["투구", "머리", "helmet", "head", "helm"] },
  { key: "armor", label: "상의", aliases: ["상의", "갑옷", "armor", "body", "chest", "torso"] },
  { key: "pants", label: "하의", aliases: ["하의", "pants", "legs"] },
  { key: "gloves", label: "장갑", aliases: ["장갑", "gloves", "hand"] },
  { key: "shoes", label: "신발", aliases: ["신발", "shoes", "boots", "foot"] },
  { key: "necklace", label: "목걸이", aliases: ["목걸이", "necklace"] },
  { key: "earring", label: "귀걸이", aliases: ["귀걸이", "earring"] },
  { key: "ring", label: "반지", aliases: ["반지", "ring"] },
  { key: "belt", label: "허리띠", aliases: ["허리", "벨트", "belt", "waist"] },
  { key: "wing", label: "날개", aliases: ["날개", "wing"] },
] as const;

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
  const officialUrl = buildOfficialUrl(
    character.server_id,
    character.character_id,
  );
  const atoolUrl = buildAtoolUrl(
    character.server_id,
    character.character_name,
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              캐릭터 상세 분석
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {character.character_name}
            </h1>
          </div>
          <LinkButton href="/profile" variant="outline">
            프로필로
          </LinkButton>
        </div>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/35">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="truncate text-2xl">
                      {character.character_name}
                    </CardTitle>
                    {character.is_primary && (
                      <Badge variant="secondary">대표 캐릭터</Badge>
                    )}
                  </div>
                  <CardDescription className="mt-1">
                    {character.server_name} 서버 ·{" "}
                    {character.class_name || "직업 미확인"} · Lv.
                    {character.character_level ?? "-"}
                  </CardDescription>
                </div>
                <div className="rounded-md border bg-background px-4 py-3 text-right">
                  <div className="text-xs font-medium text-muted-foreground">
                    전투력
                  </div>
                  <div className="font-mono text-3xl font-bold">
                    {formatCombatPower(character.combat_power)}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
              <ScoreTile
                icon={<ShieldCheck className="size-4" />}
                label="매너 온도"
                value={`${formatTemperature(profile?.manner_temperature)}°`}
                caption="파티원 평가 반영"
              />
              <ScoreTile
                icon={<Star className="size-4" />}
                label="신뢰 온도"
                value={`${formatTemperature(profile?.trust_temperature)}°`}
                caption="진도/숙련 신뢰도"
              />
              <ScoreTile
                icon={<Gauge className="size-4" />}
                label="숙련 점수"
                value={`${formatTemperature(character.proficiency_score)}점`}
                caption="캐릭터 기준 점수"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">연동 정보</CardTitle>
              <CardDescription>
                공식 정보실과 아툴 화면을 함께 열어 비교할 수 있어요.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <InfoRow label="서버 ID" value={String(character.server_id ?? "-")} />
              <InfoRow label="동기화" value={formatDate(character.synced_at)} />
              <InfoRow label="연동일" value={formatDate(character.created_at)} />
              <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-1">
                <Button asChild variant="outline">
                  <a href={officialUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    공식 정보실
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={atoolUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    아툴 보기
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <EquipmentBoard items={equipment} />
          <div className="grid gap-6">
            <DetailSection
              icon={<Swords className="size-4" />}
              title="스킬"
              items={skills}
              empty="아직 공식 정보실에서 스킬 정보를 가져오지 못했어요."
            />
            <DetailSection
              icon={<Sparkles className="size-4" />}
              title="스티그마"
              items={stigmas}
              empty="아직 공식 정보실에서 스티그마 정보를 가져오지 못했어요."
            />
          </div>
        </section>

        <p className="text-sm text-muted-foreground">
          캐릭터 정보가 바뀌었다면{" "}
          <Link href="/profile" className="underline underline-offset-4">
            프로필
          </Link>
          에서 다시 동기화하면 최신 정보로 갱신돼요.
        </p>
      </main>
    </>
  );
}

function ScoreTile({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-md border bg-background px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

type DetailItem = {
  name: string;
  level?: string | number;
  grade?: string | number;
  slot?: string | number;
  value?: string | number;
  icon?: string;
};

function EquipmentBoard({ items }: { items: DetailItem[] }) {
  const usedIndexes = new Set<number>();
  const slotted = EQUIPMENT_SLOTS.map((slot) => {
    const index = items.findIndex(
      (item, itemIndex) =>
        !usedIndexes.has(itemIndex) && isSlotMatch(item, slot.aliases),
    );
    if (index >= 0) {
      usedIndexes.add(index);
      return { slot: slot.label, item: items[index] };
    }
    return { slot: slot.label, item: undefined };
  });
  const extras = items.filter((_, index) => !usedIndexes.has(index));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4" />
              장착 아이템
            </CardTitle>
            <CardDescription>
              아툴처럼 장비 슬롯을 기준으로 현재 장착 상태를 보여줘요.
            </CardDescription>
          </div>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {slotted.map(({ slot, item }) => (
            <div
              key={slot}
              className="min-h-24 rounded-md border bg-muted/20 px-3 py-2"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {slot}
              </div>
              {item ? (
                <ItemSummary item={item} />
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  정보 없음
                </div>
              )}
            </div>
          ))}
        </div>
        {extras.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              기타 장비
            </div>
            {extras.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="rounded-md border px-3 py-2"
              >
                <ItemSummary item={item} />
              </div>
            ))}
          </div>
        )}
        {items.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            공식 정보실 응답에 장비 목록이 없어서 슬롯 자리만 먼저 표시하고
            있어요. 다음 동기화에서 장비 데이터가 들어오면 자동으로 채워져요.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DetailSection({
  icon,
  title,
  items,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  items: DetailItem[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            {empty}
          </p>
        )}
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="rounded-md border px-3 py-2">
            <ItemSummary item={item} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ItemSummary({ item }: { item: DetailItem }) {
  return (
    <div className="flex min-w-0 gap-2">
      {item.icon && (
        // Official AION2 item and skill icons are small CDN assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon}
          alt=""
          className="size-9 shrink-0 rounded-md border bg-muted object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words font-medium">{item.name}</span>
          {item.level !== undefined && (
            <Badge variant="secondary" className="shrink-0">
              Lv.{item.level}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {item.slot && <span>{item.slot}</span>}
          {item.grade && <span>{item.grade}</span>}
          {item.value !== undefined && <span>초월 {item.value}</span>}
        </div>
      </div>
    </div>
  );
}

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
    const nestedItem = asRecord(record.item);
    const nestedSkill = asRecord(record.skill);
    const source = nestedItem ?? nestedSkill ?? record;
    const name = pickText(source, [
      "name",
      "itemName",
      "skillName",
      "stigmaName",
      "displayName",
    ]);

    if (!name) continue;

    items.push({
      name: String(name),
      level: pickText(source, ["level", "enchantLevel", "skillLevel", "gradeLevel"]),
      grade: pickText(source, ["grade", "rarity", "tier", "rank"]),
      icon: pickString(source, ["icon", "iconUrl", "image", "imageUrl"]),
      slot: pickText(source, [
        "slot",
        "part",
        "equipSlot",
        "slotPosName",
        "category",
        "type",
      ]),
      value: pickText(source, [
        "value",
        "power",
        "combatPower",
        "score",
        "exceedLevel",
      ]),
    });
  }

  return items;
}

function pickText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return value;
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isSlotMatch(item: DetailItem, aliases: readonly string[]) {
  const text = `${item.slot ?? ""} ${item.name}`.toLowerCase();
  return aliases.some((alias) => text.includes(alias.toLowerCase()));
}

function formatTemperature(value: number | string | null | undefined) {
  return Number(value ?? 36.5).toFixed(1);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function buildOfficialUrl(serverId: string | number | null, characterId: string | null) {
  const server = encodeURIComponent(String(serverId ?? ""));
  const character = encodeURIComponent(characterId ?? "");
  return `https://aion2.plaync.com/ko-kr/characters/${server}/${character}`;
}

function buildAtoolUrl(serverId: string | number | null, characterName: string | null) {
  const server = encodeURIComponent(String(serverId ?? ""));
  const name = encodeURIComponent(characterName ?? "");
  return `https://aion2tool.com/char/serverid=${server}/${name}`;
}
