import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Award,
  BarChart3,
  Dices,
  Gauge,
  Gem,
  Lamp,
  Layers,
  Network,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
} from "lucide-react";
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

// Equipment is split into three visually separate groups (matching how
// 아툴 lays it out): weapon/armor, accessories, and arcana cards. Each key
// here is the lowercased official slotPosName, matched exactly against
// the normalized item's `slot` field — see SLOT_NAME_KO below for labels.
const WEAPON_ARMOR_SLOTS = [
  "mainhand",
  "subhand",
  "helmet",
  "torso",
  "pants",
  "gloves",
  "boots",
  "shoulder",
  "cape",
  "wing",
] as const;

const ACCESSORY_SLOTS = [
  "necklace",
  "earring1",
  "earring2",
  "ring1",
  "ring2",
  "belt",
  "bracelet1",
  "bracelet2",
  "brooch1",
  "brooch2",
  "rune1",
  "rune2",
  "amulet",
  "pendant",
] as const;

// arcana9/10 (주사위, 등불) have no acquisition path in-game yet, so no
// character will ever have an item there — they're kept as upcoming
// placeholders so the card shows all 10 card-shaped slots.
const ARCANA_SLOTS = [
  "arcana1",
  "arcana2",
  "arcana3",
  "arcana4",
  "arcana5",
  "arcana6",
  "arcana7",
  "arcana8",
  "arcana9",
  "arcana10",
] as const;

const ARCANA_UPCOMING_ICON: Partial<Record<string, typeof Dices>> = {
  arcana9: Dices,
  arcana10: Lamp,
};

function itemsInSlots(items: DetailItem[], slotKeys: readonly string[]) {
  const keys = new Set<string>(slotKeys);
  return items.filter((item) => keys.has(String(item.slot ?? "").toLowerCase()));
}

// Per-breakthrough (돌파) stat bonus, by slot category. Not exposed by any
// API — reverse-engineered from real in-game tooltips: weapon 돌파5 gave
// +150/+5% (30/1% per level), armor 돌파2 gave +160/+160/+2%/+2% (80/1%
// per level per stat), accessories (목걸이/귀걸이/반지/팔찌/허리띠) gave
// +100/+200/+5% (20 atk / 40 def / 1% atk per level), and a brooch 돌파5
// gave +100/+200/피해증폭+5% (same 20/40 flat rate, but the percent line
// is 피해 증폭 instead of 공격력 증가). Rune/amulet/pendant aren't
// confirmed against a real tooltip yet, so they show no bonus rather
// than a guessed number.
const EXCEED_WEAPON_SLOTS = new Set(["mainhand", "subhand"]);
const EXCEED_ARMOR_SLOTS = new Set([
  "helmet",
  "torso",
  "pants",
  "gloves",
  "boots",
  "shoulder",
  "cape",
]);
const EXCEED_ACCESSORY_PERCENT_SLOTS = new Set([
  "necklace",
  "earring1",
  "earring2",
  "ring1",
  "ring2",
  "belt",
]);
// Rune/amulet/pendant aren't confirmed against a real tooltip yet — left
// out of every bucket below so we don't show a guessed number.
const EXCEED_BROOCH_SLOTS = new Set(["brooch1", "brooch2"]);

function exceedBonusStats(item: DetailItem): NamedStat[] {
  const level = Number(item.value) || 0;
  const slot = String(item.slot ?? "").toLowerCase();
  if (level <= 0) return [];

  if (EXCEED_WEAPON_SLOTS.has(slot)) {
    return [
      { name: "공격력", value: level * 30 },
      { name: "공격력 증가", value: `${level}%` },
    ];
  }
  if (EXCEED_ARMOR_SLOTS.has(slot)) {
    return [
      { name: "방어력", value: level * 80 },
      { name: "생명력", value: level * 80 },
      { name: "방어력 증가", value: `${level}%` },
      { name: "생명력 증가", value: `${level}%` },
    ];
  }
  if (EXCEED_ACCESSORY_PERCENT_SLOTS.has(slot)) {
    return [
      { name: "공격력", value: level * 20 },
      { name: "방어력", value: level * 40 },
      { name: "공격력 증가", value: `${level}%` },
    ];
  }
  if (EXCEED_BROOCH_SLOTS.has(slot)) {
    return [
      { name: "공격력", value: level * 20 },
      { name: "방어력", value: level * 40 },
      { name: "피해 증폭", value: `${level}%` },
    ];
  }
  return [];
}

// Class-specific rows win over the '공통' fallback for the same stat_key.
function buildPriorityMap(
  rows: { stat_key: string; tier: number; class_name: string }[] | null,
  className: string | null,
): StatPriorityMap {
  const map: StatPriorityMap = new Map();
  for (const row of rows ?? []) {
    if (row.class_name === "공통") map.set(row.stat_key, row.tier);
  }
  for (const row of rows ?? []) {
    if (row.class_name === className) map.set(row.stat_key, row.tier);
  }
  return map;
}

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
      "id, character_id, character_name, server_id, server_name, class_name, character_level, combat_power, proficiency_score, equipment, skills, stigmas, stat_list, titles, daevanion, is_primary, synced_at, created_at",
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
  const weaponArmorItems = itemsInSlots(equipment, WEAPON_ARMOR_SLOTS);
  const accessoryItems = itemsInSlots(equipment, ACCESSORY_SLOTS);
  const arcanaItems = itemsInSlots(equipment, ARCANA_SLOTS);
  const arcanaSet = arcanaItems.find((item) => item.set)?.set;
  const statList = normalizeStatList(character.stat_list);
  const titles = normalizeTitleList(character.titles);
  const daevanion = normalizeDaevanionList(character.daevanion);

  const { data: priorityRows } = await supabase
    .from("class_stat_priority")
    .select("stat_key, tier, class_name")
    .in("class_name", [character.class_name, "공통"].filter(Boolean));
  const priorityMap = buildPriorityMap(priorityRows, character.class_name);

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
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <WeaponArmorCard items={weaponArmorItems} priorityMap={priorityMap} />
          <AccessoryCard items={accessoryItems} priorityMap={priorityMap} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.68fr)] 2xl:grid-cols-[minmax(0,1.18fr)_minmax(420px,0.72fr)]">
          <ArcanaCard items={arcanaItems} set={arcanaSet} priorityMap={priorityMap} />
          <SkillBoard skills={skills} stigmas={stigmas} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <DaevanionCard boards={daevanion} />
          <TitleCard titles={titles} />
        </section>

        <StatBoard statList={statList} />

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

type NamedStat = {
  name: string;
  value?: string | number;
  extra?: string | number;
  id?: string;
};

// class_name -> stat_key -> tier (1 = highest priority). Built server-side
// from the admin-curated class_stat_priority table; see StatLine.
type StatPriorityMap = Map<string, number>;
type SubSkillProc = { name: string; level?: string | number; icon?: string };
type GodStoneEffect = { name: string; desc?: string; grade?: string };
type ArcanaSetBonus = {
  name?: string;
  equippedCount?: number;
  bonuses: { degree: number; descriptions: string[] }[];
};

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
  mainStats?: NamedStat[];
  subStats?: NamedStat[];
  subSkills?: SubSkillProc[];
  magicStoneStat?: NamedStat[];
  godStoneStat?: GodStoneEffect[];
  set?: ArcanaSetBonus;
};

function SlotGrid({
  items,
  slotKeys,
  priorityMap,
}: {
  items: DetailItem[];
  slotKeys: readonly string[];
  priorityMap: StatPriorityMap;
}) {
  const usedIndexes = new Set<number>();
  const slotted = slotKeys.map((slotKey) => {
    const index = items.findIndex(
      (item, itemIndex) =>
        !usedIndexes.has(itemIndex) &&
        String(item.slot ?? "").toLowerCase() === slotKey,
    );
    if (index >= 0) {
      usedIndexes.add(index);
      return { key: slotKey, item: items[index] };
    }
    return { key: slotKey, item: undefined };
  });
  const extras = items.filter((_, index) => !usedIndexes.has(index));

  return (
    <div className="overflow-visible">
      <div className="grid grid-cols-2 gap-2 overflow-visible sm:grid-cols-3">
        {slotted.map(({ key, item }) => (
          <div
            key={key}
            className="min-h-24 overflow-visible rounded-md border bg-muted/20 px-3 py-2"
          >
            <div className="text-xs font-medium text-muted-foreground">
              {SLOT_NAME_KO[key] ?? key}
            </div>
            {item ? (
              <ItemSummary item={item} priorityMap={priorityMap} />
            ) : ARCANA_UPCOMING_ICON[key] ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                {(() => {
                  const UpcomingIcon = ARCANA_UPCOMING_ICON[key]!;
                  return <UpcomingIcon className="size-4" />;
                })()}
                출시 예정
              </div>
            ) : (
              <div className="mt-3 text-sm text-muted-foreground">
                정보 없음
              </div>
            )}
          </div>
        ))}
      </div>
      {extras.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">기타</div>
          {extras.map((item, index) => (
            <div
              key={`${item.name}-${index}`}
              className="rounded-md border px-3 py-2"
            >
              <ItemSummary item={item} priorityMap={priorityMap} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeaponArmorCard({
  items,
  priorityMap,
}: {
  items: DetailItem[];
  priorityMap: StatPriorityMap;
}) {
  return (
    <Card className="overflow-visible">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4" />
              무기 · 방어구
            </CardTitle>
            <CardDescription>
              아툴처럼 장비 슬롯을 기준으로 현재 장착 상태를 보여줘요.
            </CardDescription>
          </div>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-visible">
        <SlotGrid items={items} slotKeys={WEAPON_ARMOR_SLOTS} priorityMap={priorityMap} />
      </CardContent>
    </Card>
  );
}

function AccessoryCard({
  items,
  priorityMap,
}: {
  items: DetailItem[];
  priorityMap: StatPriorityMap;
}) {
  return (
    <Card className="overflow-visible">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gem className="size-4" />
            악세사리
          </CardTitle>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-visible">
        <SlotGrid items={items} slotKeys={ACCESSORY_SLOTS} priorityMap={priorityMap} />
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

function ArcanaCard({
  items,
  set,
  priorityMap,
}: {
  items: DetailItem[];
  set: ArcanaSetBonus | undefined;
  priorityMap: StatPriorityMap;
}) {
  return (
    <Card className="overflow-visible">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4" />
              아르카나
            </CardTitle>
            {set?.name && (
              <CardDescription>
                {set.name} · {set.equippedCount ?? 0}세트 장착
              </CardDescription>
            )}
          </div>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 overflow-visible">
        <SlotGrid items={items} slotKeys={ARCANA_SLOTS} priorityMap={priorityMap} />
        {set && set.bonuses.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {set.bonuses.map((bonus) => (
              <div key={bonus.degree} className="rounded-md border px-3 py-2">
                <Badge variant="outline" className="mb-1.5">
                  {bonus.degree}세트 효과
                </Badge>
                {bonus.descriptions.map((desc, index) => (
                  <p key={index} className="text-sm text-muted-foreground">
                    {desc}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DaevanionCard({ boards }: { boards: DaevanionBoard[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4" />
            데바니온
          </CardTitle>
          <Badge variant="outline">{boards.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {boards.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            데바니온 정보가 없어요.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {boards.map((board) => (
              <div key={board.name} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    {board.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={board.icon} alt="" className="size-4 object-contain" />
                    )}
                    {board.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {board.openNodeCount}/{board.totalNodeCount}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${Math.min(100, Math.max(0, board.openPercent))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TitleCard({ titles }: { titles: TitleEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="size-4" />
            타이틀
          </CardTitle>
          <Badge variant="outline">{titles.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {titles.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            장착한 타이틀이 없어요.
          </p>
        ) : (
          titles.map((title, index) => (
            <div key={`${title.name}-${index}`} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{title.name}</span>
                {title.grade && <Badge variant="secondary">{formatGrade(title.grade)}</Badge>}
              </div>
              {title.totalCount !== undefined && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {title.ownedCount}/{title.totalCount}명 보유
                  {title.ownedPercent !== undefined && ` (보유율 ${title.ownedPercent}%)`}
                </div>
              )}
              {title.equipStatList.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  {title.equipStatList.map((effect, effectIndex) => (
                    <span
                      key={effectIndex}
                      className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-400"
                    >
                      {effect}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function StatBoard({ statList }: { statList: StatEntry[] }) {
  const godStats = statList.filter((stat) => GOD_STAT_TYPES.includes(stat.type));
  const baseStats = statList.filter((stat) => !GOD_STAT_TYPES.includes(stat.type));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4" />
          주신 스탯
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {godStats.length === 0 && baseStats.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            스탯 정보가 없어요.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {godStats.map((stat) => (
                <div key={stat.type} className="rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{stat.name}</span>
                    <span className="font-mono text-sm">{stat.value}</span>
                  </div>
                  {stat.effects.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {stat.effects.join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {baseStats.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">일반 스탯</div>
                <div className="flex flex-wrap gap-2">
                  {baseStats.map((stat) => (
                    <Badge key={stat.type} variant="outline">
                      {stat.name} {stat.value}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function groupSkills(skills: DetailItem[], stigmas: DetailItem[]) {
  const stigmaFromSkills = skills.filter(isStigmaSkill);
  const ordinarySkills = skills.filter((skill) => !isStigmaSkill(skill));

  return {
    active: sortByLevelDesc(ordinarySkills.filter((skill) => !isPassiveSkill(skill))),
    passive: sortByLevelDesc(ordinarySkills.filter(isPassiveSkill)),
    stigma: sortByLevelDesc([...stigmas, ...stigmaFromSkills]),
  };
}

function sortByLevelDesc(items: DetailItem[]) {
  return [...items].sort((a, b) => {
    const levelA = a.level !== undefined ? Number(a.level) : -Infinity;
    const levelB = b.level !== undefined ? Number(b.level) : -Infinity;
    return levelB - levelA;
  });
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

function ItemSummary({
  item,
  priorityMap,
}: {
  item: DetailItem;
  priorityMap?: StatPriorityMap;
}) {
  const hasTooltip = hasSkillTooltip(item);

  return (
    <div className="group relative flex min-w-0 gap-2">
      {item.icon && (
        <div className="relative shrink-0">
          {/* Official AION2 item and skill icons are small CDN assets. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.icon}
            alt=""
            className="size-9 rounded-md border bg-muted object-cover"
          />
          {Number(item.value) > 0 && (
            <span
              className="absolute -top-1 -left-1 flex size-4 items-center justify-center rounded-full bg-violet-500 font-mono text-[9px] font-bold leading-none text-white ring-1 ring-background"
              title={`돌파 ${item.value}`}
            >
              {item.value}
            </span>
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span
            className={`min-w-0 break-words font-medium ${item.grade ? gradeColorClass(item.grade) : ""}`}
          >
            {item.name}
          </span>
          {item.level !== undefined && (
            <Badge variant="secondary" className="shrink-0">
              +{item.level}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {item.slot && <span>{formatCategory(item.slot)}</span>}
          {item.grade && <span className={gradeColorClass(item.grade)}>{formatGrade(item.grade)}</span>}
          {Number(item.value) > 0 && (
            <span className="font-medium text-violet-400">돌파 {item.value}</span>
          )}
        </div>
      </div>
      {hasTooltip && <SkillTooltip item={item} priorityMap={priorityMap} />}
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
  priorityMap,
}: {
  item: DetailItem;
  compact?: boolean;
  priorityMap?: StatPriorityMap;
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
      {(item.description || (!hasEquipmentDetail(item) && !item.notes)) && (
        <p className="mt-3 whitespace-pre-line break-words text-xs leading-5 text-muted-foreground">
          {item.description ||
            "공식 응답에 별도 설명문은 없지만, 스킬 레벨과 장착 상태를 확인할 수 있어요."}
        </p>
      )}
      {item.notes && (
        <div className="mt-2 rounded border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary">
          {item.notes}
        </div>
      )}
      {hasEquipmentDetail(item) && (
        <div className="mt-3 space-y-2.5 border-t pt-3">
          <StatLine title="기본 옵션" stats={item.mainStats} priorityMap={priorityMap} />
          <ExceedBonusLine stats={exceedBonusStats(item)} />
          <StatLine title="영혼 각인" stats={item.subStats} priorityMap={priorityMap} />
          {item.subSkills && item.subSkills.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground">
                각인 발동 스킬
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.subSkills.map((skill, index) => (
                  <span
                    key={`${skill.name}-${index}`}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
                  >
                    {skill.name}
                    {skill.level !== undefined ? ` Lv.${skill.level}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          <StatLine title="마석 각인" stats={item.magicStoneStat} priorityMap={priorityMap} />
          {item.godStoneStat && item.godStoneStat.length > 0 && (
            <div>
              {item.godStoneStat.map((stone, index) => (
                <div key={`${stone.name}-${index}`} className="mb-1.5 last:mb-0">
                  <div className="text-[11px] font-semibold text-amber-500">{stone.name}</div>
                  {stone.desc && (
                    <p className="mt-0.5 whitespace-pre-line break-words text-[11px] leading-4 text-muted-foreground">
                      {stone.desc}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TIER_DOT_COLOR: Record<number, string> = {
  1: "bg-violet-400",
  2: "bg-sky-400",
  3: "bg-muted-foreground",
  4: "bg-muted-foreground/40",
};

const TIER_LABELS: Record<number, string> = {
  1: "1순위 (최우선)",
  2: "2순위",
  3: "3순위",
  4: "4순위 (낮음)",
};

function StatLine({
  title,
  stats,
  priorityMap,
}: {
  title: string;
  stats?: NamedStat[];
  priorityMap?: StatPriorityMap;
}) {
  if (!stats || stats.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground">{title}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {stats.map((stat, index) => {
          const tier = stat.id ? priorityMap?.get(stat.id) : undefined;
          return (
            <span key={`${stat.name}-${index}`} className="inline-flex items-center gap-1">
              {tier !== undefined && (
                <span
                  className={`size-1.5 shrink-0 rounded-full ${TIER_DOT_COLOR[tier] ?? ""}`}
                  title={TIER_LABELS[tier]}
                />
              )}
              {stat.name}
              {stat.value !== undefined ? ` ${signed(stat.value)}` : ""}
              {stat.extra ? ` (${signed(stat.extra)})` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function signed(value: string | number) {
  const text = String(value);
  return /^[+-]/.test(text) ? text : `+${text}`;
}

// Continuation of the "기본 옵션" line, not a separate section — matches
// how the game client shows breakthrough bonuses right under the base
// options, just visually distinct (bold + colored).
function ExceedBonusLine({ stats }: { stats: NamedStat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="-mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-violet-400">
      {stats.map((stat, index) => (
        <span key={`${stat.name}-${index}`}>
          {stat.name} {signed(stat.value!)}
        </span>
      ))}
    </div>
  );
}

function hasEquipmentDetail(item: DetailItem) {
  return !!(
    (item.mainStats && item.mainStats.length > 0) ||
    (item.subStats && item.subStats.length > 0) ||
    (item.magicStoneStat && item.magicStoneStat.length > 0) ||
    (item.godStoneStat && item.godStoneStat.length > 0)
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
      level: pickText(source, ["enchantLevel", "level", "skillLevel", "gradeLevel"]),
      grade: pickText(source, ["gradeName", "grade", "rarity", "tier", "rank"]),
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
      mainStats: asStatArray(source.mainStats),
      subStats: asStatArray(source.subStats),
      subSkills: asSubSkillArray(source.subSkills),
      magicStoneStat: asStatArray(source.magicStoneStat),
      godStoneStat: asGodStoneArray(source.godStoneStat),
      set: asArcanaSet(source.set),
    });
  }

  return items;
}

function asStatArray(value: unknown): NamedStat[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? ""),
      value: entry.value as string | number | undefined,
      extra: entry.extra as string | number | undefined,
      id: typeof entry.id === "string" ? entry.id : undefined,
    }))
    .filter((entry) => entry.name);
}

function asSubSkillArray(value: unknown): SubSkillProc[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? ""),
      level: entry.level as string | number | undefined,
      icon: typeof entry.icon === "string" ? entry.icon : undefined,
    }))
    .filter((entry) => entry.name);
}

function asGodStoneArray(value: unknown): GodStoneEffect[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? ""),
      desc: typeof entry.desc === "string" ? entry.desc : undefined,
      grade: typeof entry.grade === "string" ? entry.grade : undefined,
    }))
    .filter((entry) => entry.name);
}

function asArcanaSet(value: unknown): ArcanaSetBonus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const bonuses = Array.isArray(record.bonuses)
    ? record.bonuses
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
        .map((entry) => ({
          degree: Number(entry.degree ?? 0),
          descriptions: Array.isArray(entry.descriptions)
            ? entry.descriptions.filter((d): d is string => typeof d === "string")
            : [],
        }))
    : [];
  if (bonuses.length === 0) return undefined;
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    equippedCount: typeof record.equippedCount === "number" ? record.equippedCount : undefined,
    bonuses,
  };
}

type StatEntry = { type: string; name: string; value: number; effects: string[] };

const GOD_STAT_TYPES = [
  "Justice",
  "Freedom",
  "Illusion",
  "Life",
  "Time",
  "Destruction",
  "Death",
  "Wisdom",
  "Destiny",
  "Space",
];

function normalizeStatList(value: unknown): StatEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      type: String(entry.type ?? ""),
      name: String(entry.name ?? ""),
      value: Number(entry.value ?? 0),
      effects: Array.isArray(entry.statSecondList)
        ? entry.statSecondList.filter((e): e is string => typeof e === "string")
        : [],
    }))
    .filter((entry) => entry.name);
}

type TitleEntry = {
  name: string;
  grade?: string;
  equipCategory?: string;
  ownedCount?: number;
  totalCount?: number;
  ownedPercent?: number;
  statList: string[];
  equipStatList: string[];
};

function normalizeTitleList(value: unknown): TitleEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? ""),
      grade: typeof entry.grade === "string" ? entry.grade : undefined,
      equipCategory: typeof entry.equipCategory === "string" ? entry.equipCategory : undefined,
      ownedCount: typeof entry.ownedCount === "number" ? entry.ownedCount : undefined,
      totalCount: typeof entry.totalCount === "number" ? entry.totalCount : undefined,
      ownedPercent: typeof entry.ownedPercent === "number" ? entry.ownedPercent : undefined,
      statList: extractDescList(entry.statList),
      equipStatList: extractDescList(entry.equipStatList),
    }))
    .filter((entry) => entry.name);
}

function extractDescList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => String(entry.desc ?? ""))
    .filter(Boolean);
}

type DaevanionBoard = {
  name: string;
  openNodeCount: number;
  totalNodeCount: number;
  openPercent: number;
  icon?: string;
};

function normalizeDaevanionList(value: unknown): DaevanionBoard[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? ""),
      openNodeCount: Number(entry.openNodeCount ?? 0),
      totalNodeCount: Number(entry.totalNodeCount ?? 0),
      openPercent: Number(entry.openPercent ?? 0),
      icon: typeof entry.icon === "string" ? entry.icon : undefined,
    }))
    .filter((entry) => entry.name);
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

function formatTemperature(value: number | string | null | undefined) {
  return Number(value ?? 36.5).toFixed(1);
}

function hasSkillTooltip(item: DetailItem) {
  const category = String(item.slot ?? "").toLowerCase();
  return (
    !!item.description ||
    !!item.notes ||
    item.requiredLevel !== undefined ||
    item.equipped !== undefined ||
    hasEquipmentDetail(item) ||
    category === "active" ||
    category === "passive" ||
    category === "dp" ||
    category.includes("stigma")
  );
}

const SLOT_NAME_KO: Record<string, string> = {
  mainhand: "무기",
  subhand: "보조",
  helmet: "투구",
  torso: "상의",
  pants: "하의",
  gloves: "장갑",
  boots: "신발",
  shoulder: "견갑",
  cape: "망토",
  necklace: "목걸이",
  belt: "허리띠",
  amulet: "아뮬렛",
  pendant: "펜던트",
  wing: "날개",
  earring1: "귀걸이1",
  earring2: "귀걸이2",
  ring1: "반지1",
  ring2: "반지2",
  bracelet1: "팔찌1",
  bracelet2: "팔찌2",
  brooch1: "브로치1",
  brooch2: "브로치2",
  rune1: "룬1",
  rune2: "룬2",
  arcana1: "성배",
  arcana2: "양피지",
  arcana3: "나침반",
  arcana4: "종",
  arcana5: "거울",
  arcana6: "천칭",
  arcana7: "열쇠",
  arcana8: "모래시계",
  arcana9: "주사위",
  arcana10: "등불",
};

const GRADE_NAME_KO: Record<string, string> = {
  epic: "영웅",
  unique: "유일",
  legend: "전승",
  special: "스페셜",
};

function formatGrade(value: string | number) {
  const grade = String(value);
  return GRADE_NAME_KO[grade.toLowerCase()] ?? grade;
}

const GRADE_COLOR_KO: Record<string, string> = {
  영웅: "text-orange-400",
  유일: "text-yellow-400",
  전승: "text-sky-400",
  스페셜: "text-emerald-400",
};

function gradeColorClass(value: string | number) {
  return GRADE_COLOR_KO[formatGrade(value)] ?? "";
}

function formatCategory(value: string | number) {
  const category = String(value);
  if (category.toLowerCase() === "active") return "액티브";
  if (category.toLowerCase() === "passive") return "패시브";
  if (category.toLowerCase() === "dp") return "스티그마";
  return SLOT_NAME_KO[category.toLowerCase()] ?? category;
}
