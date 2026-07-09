import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldCheck, Sparkles, Star, Swords } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { enrichAion2SkillsWithDescriptions } from "@/lib/aion2-api";
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
      "id, user_id, character_id, character_name, server_id, server_name, class_name, character_level, combat_power, equipment, skills, stigmas, is_primary, synced_at, created_at",
    )
    .eq("id", id)
    .single();

  if (!character) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("manner_temperature, trust_temperature")
    .eq("id", character.user_id)
    .single();

  const rawSkills = Array.isArray(character.skills) ? character.skills : [];
  const rawStigmas = Array.isArray(character.stigmas) ? character.stigmas : [];
  const rawSkillCount = rawSkills.length;
  const describedSkillList = await enrichAion2SkillsWithDescriptions(
    [...rawSkills, ...rawStigmas],
    character.class_name,
    character.server_id,
    character.character_name,
  ).catch(() => [...rawSkills, ...rawStigmas]);
  const describedSkills = describedSkillList.slice(0, rawSkillCount);
  const describedStigmas = describedSkillList.slice(rawSkillCount);

  const equipment = normalizeList(character.equipment);
  const skills = normalizeList(describedSkills);
  const stigmas = normalizeList(describedStigmas);

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

        <section>
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
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
              <ScoreTile
                icon={<ShieldCheck className="size-4" />}
                label="매너 점수"
                value={`${formatScore(profile?.manner_temperature)}점`}
                caption="파티원 평가 반영"
              />
              <ScoreTile
                icon={<Star className="size-4" />}
                label="신뢰 점수"
                value={`${formatScore(profile?.trust_temperature)}점`}
                caption="진도/매칭 신뢰도"
              />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.68fr)] 2xl:grid-cols-[minmax(0,1.18fr)_minmax(420px,0.72fr)]">
          <EquipmentBoard items={equipment} />
          <SkillBoard skills={skills} stigmas={stigmas} />
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

type DetailItem = {
  name: string;
  level?: string | number;
  grade?: string | number;
  slot?: string | number;
  value?: string | number;
  icon?: string;
  description?: string;
  notes?: string;
  acquired?: string | number;
  equipped?: string | number;
  requiredLevel?: string | number;
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

function SkillBoard({
  skills,
  stigmas,
}: {
  skills: DetailItem[];
  stigmas: DetailItem[];
}) {
  const groups = groupSkills(skills, stigmas);
  const total = groups.active.length + groups.passive.length + groups.stigma.length;

  return (
    <Card className="overflow-visible">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            스킬
          </CardTitle>
          <Badge variant="outline">{total}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 overflow-visible">
        <SkillGroup
          title="액티브 스킬"
          items={groups.active}
          empty="연동된 액티브 스킬이 없어요."
        />
        <SkillGroup
          title="패시브 스킬"
          items={groups.passive}
          empty="연동된 패시브 스킬이 없어요."
        />
        <SkillGroup
          title="스티그마 스킬"
          items={groups.stigma}
          empty="연동된 스티그마 스킬이 없어요."
        />
      </CardContent>
    </Card>
  );
}

function SkillGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: DetailItem[];
  empty: string;
}) {
  return (
    <section className="space-y-2 overflow-visible">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 overflow-visible">
          {items.map((item, index) => (
            <SkillIconSummary
              key={`${title}-${item.name}-${index}`}
              item={item}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function groupSkills(skills: DetailItem[], stigmas: DetailItem[]) {
  const stigmaFromSkills = skills.filter(isStigmaSkill);
  const ordinarySkills = skills.filter((skill) => !isStigmaSkill(skill));

  return {
    active: ordinarySkills.filter((skill) => !isPassiveSkill(skill)),
    passive: ordinarySkills.filter(isPassiveSkill),
    stigma: [...stigmas, ...stigmaFromSkills],
  };
}

function isPassiveSkill(item: DetailItem) {
  const category = String(item.slot ?? "").toLowerCase();
  return category.includes("passive") || category.includes("패시브");
}

function isStigmaSkill(item: DetailItem) {
  const category = String(item.slot ?? "").toLowerCase();
  return (
    category === "dp" ||
    category.includes("stigma") ||
    category.includes("스티그마")
  );
}

function ItemSummary({ item }: { item: DetailItem }) {
  const hasTooltip = hasSkillTooltip(item);

  return (
    <div className="group relative flex min-w-0 gap-2">
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
      {hasTooltip && <SkillTooltip item={item} />}
    </div>
  );
}

function SkillIconSummary({ item }: { item: DetailItem }) {
  const hasTooltip = hasSkillTooltip(item);

  return (
    <div className="group relative z-0 hover:z-50">
      <div className="relative flex size-12 items-center justify-center rounded-md border bg-muted/20 p-1.5 transition-colors group-hover:border-primary/50 group-hover:bg-primary/10">
        {item.icon ? (
          // Official AION2 skill icons are small CDN assets.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.icon}
            alt=""
            className="size-9 rounded object-cover"
          />
        ) : (
          <Sparkles className="size-5 text-muted-foreground" />
        )}
        {item.level !== undefined && (
          <span className="absolute -bottom-1 -right-1 rounded bg-background px-1 font-mono text-[10px] font-semibold leading-4 ring-1 ring-border">
            {item.level}
          </span>
        )}
      </div>
      {hasTooltip && <SkillTooltip item={item} compact />}
    </div>
  );
}

function SkillTooltip({
  item,
  compact = false,
}: {
  item: DetailItem;
  compact?: boolean;
}) {
  return (
    <div
      className={`pointer-events-none absolute z-50 hidden w-80 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg group-hover:block ${
        compact ? "right-0 top-14" : "left-0 top-11"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold">{item.name}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {item.slot && <span>{formatCategory(item.slot)}</span>}
            {item.level !== undefined && <span>Lv.{item.level}</span>}
            {item.requiredLevel !== undefined && (
              <span>요구 Lv.{item.requiredLevel}</span>
            )}
          </div>
        </div>
        {item.equipped !== undefined && (
          <Badge variant={Number(item.equipped) === 1 ? "secondary" : "outline"}>
            {Number(item.equipped) === 1 ? "장착" : "미장착"}
          </Badge>
        )}
      </div>
      <p className="mt-3 whitespace-pre-line break-words text-xs leading-5 text-muted-foreground">
        {item.description ||
          "공식 응답에 별도 설명문은 없지만, 스킬 레벨과 장착 상태를 확인할 수 있어요."}
      </p>
      {item.notes && (
        <div className="mt-2 rounded border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary">
          {item.notes}
        </div>
      )}
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
      description: pickString(source, [
        "desc",
        "description",
        "effect",
        "tooltip",
        "content",
      ]),
      notes: pickString(source, ["notes", "note", "memo"]),
      acquired: pickText(source, ["acquired"]),
      equipped: pickText(source, ["equip", "equipped"]),
      requiredLevel: pickText(source, ["needLevel", "requiredLevel"]),
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

function formatScore(value: number | string | null | undefined) {
  return Number(value ?? 36.5).toFixed(1);
}

function hasSkillTooltip(item: DetailItem) {
  const category = String(item.slot ?? "").toLowerCase();
  return (
    !!item.description ||
    !!item.notes ||
    item.requiredLevel !== undefined ||
    item.equipped !== undefined ||
    category === "active" ||
    category === "passive" ||
    category === "dp" ||
    category.includes("stigma")
  );
}

function formatCategory(value: string | number) {
  const category = String(value);
  if (category.toLowerCase() === "active") return "액티브";
  if (category.toLowerCase() === "passive") return "패시브";
  if (category.toLowerCase() === "dp") return "스티그마";
  return category;
}
