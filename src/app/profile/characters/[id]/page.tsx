import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Dices, Gem, Lamp, Layers, ShieldCheck, Sparkles, Star, Swords } from "lucide-react";
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

// Equipment is split into three visually separate cards (무기·방어구 /
// 악세사리 / 아르카나). Each key here is the lowercased official
// slotPosName, matched exactly against the normalized item's `slot`
// field — see SLOT_NAME_KO below for display labels.
// Order matches the in-game equipment panel layout, per user reference
// (weapon, subhand, helmet, shoulder, torso, belt, pants, gloves, cape,
// boots). Wing is intentionally excluded — it's already shown in the
// companion/wing card via detailData.petwing.wing.
const WEAPON_ARMOR_SLOTS = [
  "mainhand",
  "subhand",
  "helmet",
  "shoulder",
  "torso",
  "belt",
  "pants",
  "gloves",
  "cape",
  "boots",
] as const;

const ACCESSORY_SLOTS = [
  "earring1",
  "earring2",
  "necklace",
  "amulet",
  "ring1",
  "ring2",
  "brooch1",
  "brooch2",
  "bracelet1",
  "bracelet2",
  "rune1",
  "rune2",
  "pendant",
] as const;

// arcana9/10 (주사위, 등불) have no acquisition path in-game yet, so no
// character will ever have an item there — kept as upcoming placeholders
// so the card shows all 10 card-shaped slots.
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
  earring1: "귀걸이1",
  earring2: "귀걸이2",
  ring1: "반지1",
  ring2: "반지2",
  belt: "허리띠",
  bracelet1: "팔찌1",
  bracelet2: "팔찌2",
  brooch1: "브로치1",
  brooch2: "브로치2",
  rune1: "룬1",
  rune2: "룬2",
  amulet: "아뮬렛",
  pendant: "펜던트",
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

const ARCANA_UPCOMING_ICON: Partial<Record<string, typeof Dices>> = {
  arcana9: Dices,
  arcana10: Lamp,
};

function itemsInSlots(items: DetailItem[], slotKeys: readonly string[]) {
  const keys = new Set<string>(slotKeys);
  return items.filter((item) => keys.has(String(item.slot ?? "").toLowerCase()));
}

export default async function CharacterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const activeTab = query?.tab === "daevanion" ? "daevanion" : "equipment";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect(`/login?next=${encodeURIComponent(`/profile/characters/${id}`)}`);
  }

  const { data: character } = await supabase
    .from("aion2_characters")
    .select(
      "id, user_id, character_id, character_name, server_id, server_name, class_name, character_level, combat_power, equipment, skills, stigmas, detail_data, is_primary, synced_at, created_at",
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

  const detailData = asRecord(character.detail_data);
  const detailProfile = asRecord(detailData?.profile);
  const profileImage = detailProfile
    ? pickString(detailProfile, ["profileImage", "profileImageUrl", "image", "imageUrl"])
    : undefined;
  const itemLevel = asRecord(detailData?.summary)?.itemLevel;
  const equipment = normalizeList(character.equipment);
  const skills = normalizeList(describedSkills);
  const stigmas = normalizeList(describedStigmas);
  const weaponArmorItems = itemsInSlots(equipment, WEAPON_ARMOR_SLOTS);
  const accessoryItems = itemsInSlots(equipment, ACCESSORY_SLOTS);
  const arcanaItems = itemsInSlots(equipment, ARCANA_SLOTS);
  const arcanaSet = arcanaItems
    .map((item) => asRecord(asRecord(item.detail)?.set))
    .find((set): set is Record<string, unknown> => !!set);

  const { data: priorityRows } = await supabase
    .from("class_stat_priority")
    .select("stat_key, tier, class_name")
    .in("class_name", [character.class_name, "공통"].filter(Boolean));
  const priorityMap = buildPriorityMap(priorityRows, character.class_name);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              아이온2 캐릭터 상세
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {character.character_name}
            </h1>
          </div>
          <LinkButton href="/profile" variant="outline">
            프로필로
          </LinkButton>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/35 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted sm:size-24">
                  {profileImage ? (
                    // Official AION2 profile images are remote CDN assets.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profileImage}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Sparkles className="size-8 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    {character.character_name}
                    {character.is_primary && (
                      <Badge variant="secondary">대표</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {character.server_name} · {character.class_name || "직업 미확인"} · Lv.{character.character_level ?? "-"}
                  </CardDescription>
                </div>
              </div>
              <div className="flex divide-x rounded-md border bg-background text-right">
                <div className="px-4 py-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    전투력
                  </div>
                  <div className="font-mono text-3xl font-bold text-primary">
                    {formatCombatPower(character.combat_power)}
                  </div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    아이템 레벨
                  </div>
                  <div className="font-mono text-3xl font-bold text-primary">
                    {formatPlainValue(itemLevel ?? "-")}
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
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

        <nav className="flex w-fit rounded-md border bg-muted/20 p-1">
          <Link
            href={`/profile/characters/${id}`}
            className={
              "rounded px-4 py-2 text-sm font-medium transition-colors " +
              (activeTab === "equipment"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            장비 / 스킬
          </Link>
          <Link
            href={`/profile/characters/${id}?tab=daevanion`}
            className={
              "rounded px-4 py-2 text-sm font-medium transition-colors " +
              (activeTab === "daevanion"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            데바니온
          </Link>
        </nav>

        {activeTab === "equipment" ? (
          <>
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
              <div className="space-y-5">
                <WeaponArmorCard items={weaponArmorItems} priorityMap={priorityMap} />
                <AccessoryCard items={accessoryItems} priorityMap={priorityMap} />
                <ArcanaCard items={arcanaItems} set={arcanaSet} />
              </div>
              <div className="space-y-5">
                <SkillBoard skills={skills} stigmas={stigmas} />
                <CharacterStatsCard detailData={detailData} />
                <CompanionCard detailData={detailData} />
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <RankingCard detailData={detailData} />
              <DaevanionCard detailData={detailData} />
            </section>
          </>
        ) : (
          <DaevanionDetailTab detailData={detailData} />
        )}

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
  detail?: unknown;
};

// class_name -> stat_key -> tier (1 = highest priority). Built server-side
// from the admin-curated class_stat_priority table (see /admin); class-
// specific rows win over the shared '공통' fallback for the same stat_key.
type StatPriorityMap = Map<string, number>;

const TIER_ACCENT_COLOR: Record<number, string> = {
  1: "#a78bfa",
  2: "#38bdf8",
  3: "#9ca3af",
  4: "#6b7280",
};

const TIER_LABELS: Record<number, string> = {
  1: "1순위 (최우선)",
  2: "2순위",
  3: "3순위",
  4: "4순위 (낮음)",
};

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
      return { key: slotKey, slot: SLOT_NAME_KO[slotKey] ?? slotKey, item: items[index] };
    }
    return { key: slotKey, slot: SLOT_NAME_KO[slotKey] ?? slotKey, item: undefined };
  });
  const extras = items.filter((_, index) => !usedIndexes.has(index));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {slotted.map((slot) => (
          <EquipmentSlotCard
            key={slot.key}
            slot={slot}
            priorityMap={priorityMap}
            upcomingIcon={ARCANA_UPCOMING_ICON[slot.key]}
            compact
          />
        ))}
      </div>
      {extras.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {extras.map((item, index) => (
            <EquipmentSlotCard
              key={`extra-${index}`}
              slot={{ slot: "기타", item }}
              priorityMap={priorityMap}
              compact
            />
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
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4" />
              무기 · 방어구
            </CardTitle>
            <CardDescription>주무기, 보조, 방어구 슬롯이에요.</CardDescription>
          </div>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-5">
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
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gem className="size-4" />
            악세사리
          </CardTitle>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-5">
        <SlotGrid items={items} slotKeys={ACCESSORY_SLOTS} priorityMap={priorityMap} />
      </CardContent>
    </Card>
  );
}

function ArcanaCard({
  items,
  set,
}: {
  items: DetailItem[];
  set: Record<string, unknown> | undefined;
}) {
  const bonuses = asArray(set?.bonuses);
  return (
    <Card className="overflow-visible">
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4" />
              아르카나
            </CardTitle>
            {set?.name !== undefined && (
              <CardDescription>
                {formatPlainValue(set.name)} · {formatPlainValue(set.equippedCount ?? 0)}세트 장착
              </CardDescription>
            )}
          </div>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-3 sm:p-5">
        <ArcanaTileGrid items={items} slotKeys={ARCANA_SLOTS} />
        {bonuses.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {bonuses.map((bonus, index) => {
              const record = asRecord(bonus) ?? {};
              const descriptions = asArray(record.descriptions);
              return (
                <div key={index} className="rounded-md border bg-background/55 px-3 py-2">
                  <Badge variant="outline" className="mb-1.5">
                    {formatPlainValue(record.degree)}세트 효과
                  </Badge>
                  {descriptions.map((desc, descIndex) => (
                    <p key={descIndex} className="text-sm text-muted-foreground">
                      {formatPlainValue(desc)}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentSlotCard({
  slot,
  priorityMap,
  upcomingIcon: UpcomingIcon,
  compact = false,
}: {
  slot?: { slot: string; item?: DetailItem };
  priorityMap?: StatPriorityMap;
  upcomingIcon?: typeof Dices;
  compact?: boolean;
}) {
  const gradeColor = slot?.item ? getEquipmentGradeColor(slot.item) : undefined;

  return (
    <div
      className={
        "min-h-20 rounded-md border bg-muted/20 p-2.5 " +
        (compact ? "" : "lg:min-h-[92px]")
      }
      style={gradeColor ? { borderColor: `${gradeColor}66`, boxShadow: `inset 0 0 0 1px ${gradeColor}18` } : undefined}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {slot?.slot ?? "슬롯"}
        </span>
        {slot?.item?.grade && (
          <span className="truncate text-[11px] font-medium" style={{ color: gradeColor }}>
            {formatGradeName(slot.item.grade)}
          </span>
        )}
      </div>
      {slot?.item ? (
        <ItemSummary item={slot.item} compact={compact} priorityMap={priorityMap} />
      ) : UpcomingIcon ? (
        <div className="flex min-h-10 items-center justify-center gap-1.5 rounded border border-dashed text-xs text-muted-foreground">
          <UpcomingIcon className="size-3.5" />
          출시 예정
        </div>
      ) : (
        <div className="flex min-h-10 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
          정보 없음
        </div>
      )}
    </div>
  );
}

function ArcanaTileGrid({
  items,
  slotKeys,
}: {
  items: DetailItem[];
  slotKeys: readonly string[];
}) {
  const usedIndexes = new Set<number>();
  const tiles = slotKeys.map((slotKey) => {
    const index = items.findIndex(
      (item, itemIndex) =>
        !usedIndexes.has(itemIndex) &&
        String(item.slot ?? "").toLowerCase() === slotKey,
    );
    if (index >= 0) {
      usedIndexes.add(index);
      return { key: slotKey, label: SLOT_NAME_KO[slotKey] ?? slotKey, item: items[index] };
    }
    return { key: slotKey, label: SLOT_NAME_KO[slotKey] ?? slotKey, item: undefined };
  });

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {tiles.map((tile) => (
        <ArcanaTile
          key={tile.key}
          label={tile.label}
          item={tile.item}
          upcomingIcon={ARCANA_UPCOMING_ICON[tile.key]}
        />
      ))}
    </div>
  );
}

function ArcanaTile({
  label,
  item,
  upcomingIcon: UpcomingIcon,
}: {
  label: string;
  item?: DetailItem;
  upcomingIcon?: typeof Dices;
}) {
  const gradeColor = item ? getEquipmentGradeColor(item) : undefined;

  return (
    <div
      className="flex flex-col items-center gap-1 rounded-md border bg-muted/20 p-2 text-center"
      style={gradeColor ? { borderColor: `${gradeColor}66`, boxShadow: `inset 0 0 0 1px ${gradeColor}18` } : undefined}
    >
      {item?.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon}
          alt=""
          className="size-10 rounded-md border bg-muted object-cover"
          style={{ borderColor: `${gradeColor}88` }}
        />
      ) : UpcomingIcon ? (
        <UpcomingIcon className="size-6 text-muted-foreground" />
      ) : (
        <Layers className="size-6 text-muted-foreground" />
      )}
      <div className="w-full truncate text-[11px] font-medium">{item?.name ?? label}</div>
      <div className="text-[10px] text-muted-foreground">
        {item
          ? item.level !== undefined
            ? `+${item.level}`
            : "장착"
          : UpcomingIcon
            ? "출시 예정"
            : "미장착"}
      </div>
    </div>
  );
}

function CharacterStatsCard({ detailData }: { detailData?: Record<string, unknown> }) {
  const stats = asArray(detailData?.stats).slice(0, 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{"\uc2a4\ud0ef \uc694\uc57d"}</CardTitle>
        <CardDescription>{"\uacf5\uc2dd \uc815\ubcf4\uc2e4\uc758 \uc8fc\uc694 \ub2a5\ub825\uce58\ub97c \uc815\ub9ac\ud588\uc5b4\uc694."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {stats.map((stat, index) => (
              <InfoRow key={index} item={stat} />
            ))}
          </div>
        ) : (
          <EmptyText>{"\uc2a4\ud0ef \uc815\ubcf4\uac00 \uc544\uc9c1 \uc5c6\uc5b4\uc694."}</EmptyText>
        )}
      </CardContent>
    </Card>
  );
}

function CompanionCard({ detailData }: { detailData?: Record<string, unknown> }) {
  const petwing = asRecord(detailData?.petwing);
  const entries = [
    { label: "Pet", item: asRecord(petwing?.pet) },
    { label: "Wing", item: asRecord(petwing?.wing) },
    { label: "Skin", item: asRecord(petwing?.wingSkin) },
  ].filter((entry) => entry.item);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{"\ud3ab / \ub0a0\uac1c"}</CardTitle>
        <CardDescription>{"\uc7a5\ucc29 \uc911\uc778 \ub3d9\ub8cc\uc640 \ub0a0\uac1c \uc815\ubcf4\uc785\ub2c8\ub2e4."}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {entries.map((entry) => (
              <CompanionTile key={entry.label} label={entry.label} item={entry.item!} />
            ))}
          </div>
        ) : <EmptyText>{"\ud3ab/\ub0a0\uac1c \uc815\ubcf4\uac00 \uc544\uc9c1 \uc5c6\uc5b4\uc694."}</EmptyText>}
      </CardContent>
    </Card>
  );
}

function RankingCard({ detailData }: { detailData?: Record<string, unknown> }) {
  const rankings = asArray(detailData?.rankings).slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{"\ub7ad\ud0b9"}</CardTitle>
        <CardDescription>{"\uacf5\uc2dd \uc815\ubcf4\uc2e4\uc5d0\uc11c \ud655\uc778\ub41c \ucf58\ud150\uce20\ubcc4 \ub7ad\ud0b9\uc785\ub2c8\ub2e4."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rankings.length > 0 ? rankings.map((ranking, index) => (
          <InfoRow key={index} item={ranking} primaryKeys={["rankingContentsName", "rankingContentsType"]} valueKeys={["rank", "point", "gradeName"]} />
        )) : <EmptyText>{"\ub7ad\ud0b9 \uc815\ubcf4\uac00 \uc544\uc9c1 \uc5c6\uc5b4\uc694."}</EmptyText>}
      </CardContent>
    </Card>
  );
}

function DaevanionCard({ detailData }: { detailData?: Record<string, unknown> }) {
  const boards = asArray(asRecord(detailData?.daevanion)?.boards);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{"\ub370\ubc14\ub2c8\uc628"}</CardTitle>
        <CardDescription>{"\ubcf4\ub4dc\ubcc4 \uac1c\ubc29 \uc9c4\ud589\ub3c4\ub97c \ubcf4\uc5ec\uc90d\ub2c8\ub2e4."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {boards.length > 0 ? boards.map((board, index) => {
          const record = asRecord(board) ?? {};
          return (
            <div key={index} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{formatPlainValue(record.name ?? record.id ?? "Board")}</span>
                <Badge variant="outline">{formatPercent(record.openPercent)}</Badge>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: formatCssPercent(record.openPercent) }} />
              </div>
            </div>
          );
        }) : <EmptyText>{"\ub370\ubc14\ub2c8\uc628 \uc815\ubcf4\uac00 \uc544\uc9c1 \uc5c6\uc5b4\uc694."}</EmptyText>}
      </CardContent>
    </Card>
  );
}

function DaevanionDetailTab({ detailData }: { detailData?: Record<string, unknown> }) {
  const normalized = asRecord(detailData?.normalized);
  const daevanion = asRecord(detailData?.daevanion);
  const boards = asArray(normalized?.daevanionBoards).length > 0
    ? asArray(normalized?.daevanionBoards)
    : asArray(daevanion?.boards);
  const details = asArray(daevanion?.details);

  return (
    <section className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">데바니온 상세</CardTitle>
          <CardDescription>
            공식 정보실에서 가져온 보드 진행률, 열린 스탯/스킬 효과, 노드 배치를 정리했어요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {boards.length > 0 ? (
            boards.map((board, index) => (
              <DaevanionBoardDetail
                key={String(asRecord(board)?.id ?? index)}
                board={board}
                detail={findDaevanionDetail(details, asRecord(board)?.id)}
              />
            ))
          ) : (
            <EmptyText>데바니온 정보가 아직 없어요.</EmptyText>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function DaevanionBoardDetail({
  board,
  detail,
}: {
  board: unknown;
  detail?: Record<string, unknown>;
}) {
  const record = asRecord(board) ?? {};
  const rawNodes = asArray(record.nodes).length > 0
    ? asArray(record.nodes)
    : asArray(detail?.nodeList).map(normalizeDaevanionNode);
  const nodes = rawNodes
    .map(normalizeDaevanionNode)
    .filter((node) => Number.isFinite(node.row) && Number.isFinite(node.col));
  const statEffects = asArray(detail?.openStatEffectList);
  const skillEffects = asArray(detail?.openSkillEffectList);

  return (
    <article className="rounded-md border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {typeof record.icon === "string" && record.icon ? (
            // Official AION2 board icons are remote CDN assets.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={record.icon} alt="" className="size-10 rounded-md border bg-muted object-cover" />
          ) : (
            <Sparkles className="size-8 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              {formatPlainValue(record.name ?? record.id ?? "Board")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {formatPlainValue(record.openNodeCount ?? 0)} / {formatPlainValue(record.totalNodeCount ?? nodes.length)} 노드 개방
            </p>
          </div>
        </div>
        <Badge variant="outline">{formatPercent(record.openPercent)}</Badge>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: formatCssPercent(record.openPercent) }} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <EffectList title="열린 스탯 효과" items={statEffects} />
        <EffectList title="열린 스킬 효과" items={skillEffects} />
      </div>

      <div className="mt-4">
        <div className="mb-2 text-sm font-semibold">노드 배치</div>
        {nodes.length > 0 ? (
          <DaevanionNodeGrid nodes={nodes} />
        ) : (
          <EmptyText>노드 상세 정보가 아직 없어요.</EmptyText>
        )}
      </div>
    </article>
  );
}

function EffectList({ title, items }: { title: string; items: unknown[] }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, index) => {
            const record = asRecord(item);
            return (
              <Badge key={index} variant="outline" className="max-w-full whitespace-normal text-left">
                {formatPlainValue(record?.desc ?? item)}
              </Badge>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">열린 효과가 없어요.</p>
      )}
    </div>
  );
}

type DaevanionNode = {
  name: string;
  row: number;
  col: number;
  grade: string;
  type: string;
  open: boolean;
  effects: unknown[];
};

function DaevanionNodeGrid({ nodes }: { nodes: DaevanionNode[] }) {
  const visibleNodes = nodes.filter((node) => node.type !== "None" || node.name || node.open);
  const minRow = Math.min(...nodes.map((node) => node.row));
  const minCol = Math.min(...nodes.map((node) => node.col));
  const maxRow = Math.max(...nodes.map((node) => node.row));
  const maxCol = Math.max(...nodes.map((node) => node.col));
  const columns = Math.max(1, maxCol - minCol + 1);
  const rows = Math.max(1, maxRow - minRow + 1);

  return (
    <div className="overflow-x-auto rounded-md border bg-muted/10 p-3">
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${columns}, 24px)`,
          gridTemplateRows: `repeat(${rows}, 24px)`,
          minWidth: `${columns * 28}px`,
        }}
      >
        {visibleNodes.map((node, index) => {
          const color = getDaevanionNodeColor(node.grade);
          return (
            <div
              key={`${node.row}-${node.col}-${index}`}
              className={
                "size-6 rounded-sm border text-[0px] transition-opacity " +
                (node.open ? "opacity-100" : "opacity-35")
              }
              style={{
                gridColumn: node.col - minCol + 1,
                gridRow: node.row - minRow + 1,
                borderColor: color.border,
                backgroundColor: node.open ? color.bg : "rgba(148,163,184,0.08)",
                boxShadow: node.open ? `0 0 8px ${color.glow}` : undefined,
              }}
              title={formatDaevanionNodeTitle(node)}
            />
          );
        })}
      </div>
    </div>
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
        <div className="grid grid-cols-4 gap-2 overflow-visible sm:grid-cols-5 lg:grid-cols-6">
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
  const leveledSkills = skills.filter(hasPositiveSkillLevel);
  const leveledStigmas = stigmas.filter(hasPositiveSkillLevel);
  const stigmaFromSkills = leveledSkills.filter(isStigmaSkill);
  const ordinarySkills = leveledSkills.filter((skill) => !isStigmaSkill(skill));

  return {
    active: sortByLevelDesc(ordinarySkills.filter((skill) => !isPassiveSkill(skill))),
    passive: sortByLevelDesc(ordinarySkills.filter(isPassiveSkill)),
    stigma: sortByLevelDesc([...leveledStigmas, ...stigmaFromSkills]),
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

function hasPositiveSkillLevel(item: DetailItem) {
  const level = Number(item.level ?? 0);
  return Number.isFinite(level) && level > 0;
}

function ItemSummary({
  item,
  compact = false,
  priorityMap,
}: {
  item: DetailItem;
  compact?: boolean;
  priorityMap?: StatPriorityMap;
}) {
  const gradeColor = getEquipmentGradeColor(item);
  const detail = asRecord(item.detail);
  const mainStats = asArray(detail?.mainStats);
  const magicStones = asArray(detail?.magicStoneStat);
  const godStones = asArray(detail?.godStoneStat);
  // Gear-granted skills (subSkills) are just another soul-engraving
  // option in-game, so they're shown in the same section as subStats
  // instead of a separate "장비 스킬" box.
  const soulOptions = [...asArray(detail?.subStats), ...asArray(detail?.subSkills)];
  const exceedStats = exceedBonusStats(item);
  const breakthroughGradientKey = String(item.slot ?? item.name ?? "item").replace(/[^a-zA-Z0-9_-]/g, "");
  const breakthroughTopId = `breakthroughTop-${breakthroughGradientKey || "item"}-${item.value}`;
  const breakthroughSideId = `breakthroughSide-${breakthroughGradientKey || "item"}-${item.value}`;
  const breakthroughBottomId = `breakthroughBottom-${breakthroughGradientKey || "item"}-${item.value}`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {Number(item.value) > 0 && (
          <div className="flex shrink-0 items-center" title={`돌파 ${item.value}`}>
            <div
              className="relative overflow-visible"
              style={{
                width: compact ? "27px" : "29px",
                height: compact ? "27px" : "29px",
                filter:
                  "drop-shadow(0 0 5px rgba(56,189,248,0.72)) drop-shadow(0 2px 2px rgba(0,0,0,0.75))",
              }}
            >
              <svg
                aria-hidden="true"
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  <linearGradient
                    id={breakthroughTopId}
                    x1="28"
                    y1="12"
                    x2="72"
                    y2="53"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#f0fdff" />
                    <stop offset="0.48" stopColor="#67e8f9" />
                    <stop offset="1" stopColor="#0891b2" />
                  </linearGradient>
                  <linearGradient
                    id={breakthroughSideId}
                    x1="88"
                    y1="24"
                    x2="44"
                    y2="92"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#38bdf8" />
                    <stop offset="1" stopColor="#075985" />
                  </linearGradient>
                  <linearGradient
                    id={breakthroughBottomId}
                    x1="50"
                    y1="47"
                    x2="50"
                    y2="99"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#0284c7" />
                    <stop offset="1" stopColor="#082f49" />
                  </linearGradient>
                </defs>
                <path
                  d="M50 2C58 24 72 42 98 50C72 58 58 72 50 98C42 72 28 58 2 50C28 42 42 24 50 2Z"
                  fill="#0891b2"
                  stroke="rgba(224,252,255,0.96)"
                  strokeLinejoin="round"
                  strokeWidth="4"
                />
                <path
                  d="M50 2C58 24 72 42 98 50C72 45 60 42 50 50C40 42 28 45 2 50C28 42 42 24 50 2Z"
                  fill={`url(#${breakthroughTopId})`}
                />
                <path
                  d="M98 50C72 58 58 72 50 98C55 72 58 60 50 50C60 42 72 45 98 50Z"
                  fill={`url(#${breakthroughSideId})`}
                />
                <path
                  d="M50 98C42 72 28 58 2 50C28 55 40 58 50 50C60 58 72 55 98 50C72 58 58 72 50 98Z"
                  fill={`url(#${breakthroughBottomId})`}
                />
                <path
                  d="M2 50C28 42 42 24 50 2C45 28 42 40 50 50C42 60 45 72 2 50Z"
                  fill="rgba(34,211,238,0.7)"
                />
                <path
                  d="M50 2C45 28 42 40 50 50"
                  fill="none"
                  stroke="rgba(240,253,255,0.78)"
                  strokeLinecap="round"
                  strokeWidth="4.5"
                />
                <path
                  d="M98 50C72 45 60 42 50 50"
                  fill="none"
                  stroke="rgba(224,252,255,0.36)"
                  strokeLinecap="round"
                  strokeWidth="4.5"
                />
                <path
                  d="M50 98C55 72 58 60 50 50"
                  fill="none"
                  stroke="rgba(8,47,73,0.62)"
                  strokeLinecap="round"
                  strokeWidth="4.5"
                />
                <path
                  d="M2 50C28 55 40 58 50 50"
                  fill="none"
                  stroke="rgba(6,78,118,0.48)"
                  strokeLinecap="round"
                  strokeWidth="4.5"
                />
                <path
                  d="M50 38C58 43 63 47 68 50C63 53 58 57 50 62C42 57 37 53 32 50C37 47 42 43 50 38Z"
                  fill="rgba(240,253,255,0.16)"
                  stroke="rgba(224,252,255,0.42)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <span className="absolute inset-[30%] rounded-full bg-sky-950/20 blur-[1px]" />
              <span
                className="absolute inset-0 flex items-center justify-center text-sm font-black leading-none text-white"
                style={{
                  WebkitTextStroke: "1px rgba(0,0,0,0.92)",
                  textShadow: "0 0 1px #000, 0 1px 0 rgba(0,0,0,0.85)",
                }}
              >
                {item.value}
              </span>
            </div>
          </div>
        )}
        {item.icon && (
          <div className="relative shrink-0">
            {/* Official AION2 item and skill icons are small CDN assets. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.icon}
              alt=""
              className={(compact ? "size-8" : "size-9") + " rounded-md border bg-muted object-cover"}
              style={{ borderColor: `${gradeColor}88` }}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className={(compact ? "text-sm " : "") + "min-w-0 break-words font-medium"}>{item.name}</span>
            {item.level !== undefined && (
              <Badge variant="secondary" className="shrink-0">
                +{item.level}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {item.slot && <span>{item.slot}</span>}
            {item.grade && <span>{formatGradeName(item.grade)}</span>}
            {Number(item.value) > 0 && (
              <span className="font-medium text-sky-400">돌파 {item.value}</span>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <OptionSection title="주 능력치" items={mainStats} />
        <OptionSection title="돌파 보너스" items={exceedStats} />
        <OptionSection title="영혼각인 옵션" items={soulOptions} priorityMap={priorityMap} icon level />
        <OptionSection title="마석" items={magicStones} icon />
        <OptionSection title="신석" items={godStones} icon description />
      </div>
    </div>
  );
}

function SkillIconSummary({ item }: { item: DetailItem }) {
  return (
    <div className="flex min-h-24 flex-col items-center gap-1 rounded-md border bg-muted/20 p-1.5 text-center">
      <div className="relative flex size-9 items-center justify-center">
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
      </div>
      <div className="line-clamp-2 w-full text-[10px] font-medium leading-tight">
        {item.name}
      </div>
      <div className="font-mono text-[10px] font-semibold text-primary">
        Lv.{formatPlainValue(item.level)}
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
      detail: record.detail ?? source.detail,
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

function getOptionAccentColor(title: string, record: Record<string, unknown>) {
  if (title === "마석" || title === "신석") {
    return getOptionGradeColor(record.grade);
  }
  if (title === "돌파 보너스") {
    return "#a78bfa";
  }
  return undefined;
}

function getGradeKey(grade: unknown) {
  const value = String(grade ?? "").trim().toLowerCase();
  if (value.includes("epic") || value.includes("영웅")) return "epic";
  if (value.includes("unique") || value.includes("유일")) return "unique";
  if (value.includes("legend") || value.includes("전승")) return "legend";
  if (value.includes("special") || value.includes("스페셜")) return "special";
  if (value.includes("rare") || value.includes("희귀")) return "rare";
  if (value.includes("common") || value.includes("normal") || value.includes("일반")) return "common";
  return "";
}

function formatGradeName(grade: unknown) {
  const key = getGradeKey(grade);
  if (key === "epic") return "영웅";
  if (key === "unique") return "유일";
  if (key === "legend") return "전승";
  if (key === "special") return "스페셜";
  if (key === "rare") return "희귀";
  if (key === "common") return "일반";
  return formatPlainValue(grade);
}

function getOptionGradeColor(grade: unknown) {
  const key = getGradeKey(grade);
  if (key === "epic") return "#FF6B35";
  if (key === "unique") return "#FFD700";
  if (key === "legend") return "#4a90e2";
  if (key === "special") return "#34d399";
  if (key === "rare") return "#4caf50";
  if (key === "common") return "#a0a0a0";
  return undefined;
}

function getEquipmentGradeColor(item: DetailItem) {
  return getOptionGradeColor(asRecord(item.detail)?.grade ?? item.grade) ?? "#8b5cf6";
}

function OptionSection({
  title,
  items,
  icon = false,
  description = false,
  level = false,
  priorityMap,
}: {
  title: string;
  items: unknown[];
  icon?: boolean;
  description?: boolean;
  level?: boolean;
  priorityMap?: StatPriorityMap;
}) {
  if (items.length === 0) return null;
  const isSoulOption = title === "영혼각인 옵션";
  return (
    <div className="space-y-1 rounded border bg-background/60 p-2">
      <div className="text-[11px] font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-1">
        {items.slice(0, 20).map((item, index) => {
          const record = asRecord(item) ?? {};
          const name = formatPlainValue(record.name ?? record.id ?? "-");
          const value = record.value !== undefined ? formatPlainValue(record.value) : "";
          const tier =
            isSoulOption && typeof record.id === "string"
              ? priorityMap?.get(record.id)
              : undefined;
          const accentColor = isSoulOption
            ? (tier !== undefined ? TIER_ACCENT_COLOR[tier] : undefined)
            : getOptionAccentColor(title, record);
          const hasIcon = icon && typeof record.icon === "string" && !!record.icon;
          return (
            <div
              key={`${title}-${index}`}
              className="flex min-w-0 items-start gap-2 rounded-sm border-l-2 px-2 py-1 text-xs"
              style={{
                borderLeftColor: accentColor ?? "transparent",
                backgroundColor: accentColor ? `${accentColor}12` : undefined,
              }}
              title={tier !== undefined ? TIER_LABELS[tier] : undefined}
            >
              {hasIcon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={record.icon as string}
                  alt=""
                  className="mt-0.5 size-5 shrink-0 rounded border bg-muted object-cover"
                  style={accentColor ? { borderColor: `${accentColor}aa` } : undefined}
                />
              ) : accentColor ? (
                <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" style={accentColor && isSoulOption ? { color: accentColor } : undefined}>
                    {name}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {record.grade !== undefined && !isSoulOption && (
                      <span className="w-10 shrink-0 text-right text-[10px] font-medium" style={{ color: accentColor }}>
                        {formatGradeName(record.grade)}
                      </span>
                    )}
                    {value && <span className="shrink-0 text-right font-medium" style={accentColor ? { color: accentColor } : undefined}>{value}</span>}
                    {level && record.level !== undefined && <span className="shrink-0 text-muted-foreground">Lv.{formatPlainValue(record.level)}</span>}
                  </div>
                </div>
                {description && record.desc !== undefined && (
                  <div className="mt-1 whitespace-pre-line text-[11px] leading-4 text-muted-foreground">
                    {formatPlainValue(record.desc)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
const EXCEED_BROOCH_SLOTS = new Set(["brooch1", "brooch2"]);

type ExceedStat = { name: string; value: string | number };

function exceedBonusStats(item: DetailItem): ExceedStat[] {
  const level = Number(item.value) || 0;
  const slot = String(item.slot ?? "").toLowerCase();
  if (level <= 0) return [];

  if (EXCEED_WEAPON_SLOTS.has(slot)) {
    return [
      { name: "공격력", value: `+${level * 30}` },
      { name: "공격력 증가", value: `+${level}%` },
    ];
  }
  if (EXCEED_ARMOR_SLOTS.has(slot)) {
    return [
      { name: "방어력", value: `+${level * 80}` },
      { name: "생명력", value: `+${level * 80}` },
      { name: "방어력 증가", value: `+${level}%` },
      { name: "생명력 증가", value: `+${level}%` },
    ];
  }
  if (EXCEED_ACCESSORY_PERCENT_SLOTS.has(slot)) {
    return [
      { name: "공격력", value: `+${level * 20}` },
      { name: "방어력", value: `+${level * 40}` },
      { name: "공격력 증가", value: `+${level}%` },
    ];
  }
  if (EXCEED_BROOCH_SLOTS.has(slot)) {
    return [
      { name: "공격력", value: `+${level * 20}` },
      { name: "방어력", value: `+${level * 40}` },
      { name: "피해 증폭", value: `+${level}%` },
    ];
  }
  return [];
}

function InfoRow({
  item,
  primaryKeys = ["name", "type", "rankingContentsName"],
  valueKeys = ["value", "rank", "point"],
}: {
  item: unknown;
  primaryKeys?: string[];
  valueKeys?: string[];
}) {
  const record = asRecord(item) ?? {};
  const label = pickText(record, primaryKeys) ?? "-";
  const value = pickText(record, valueKeys) ?? "-";
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{formatPlainValue(label)}</span>
      <span className="shrink-0 font-medium">{formatPlainValue(value)}</span>
    </div>
  );
}

function CompanionTile({ label, item }: { label: string; item: Record<string, unknown> }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border bg-muted/20 p-2 text-center">
      {typeof item.icon === "string" && item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.icon} alt="" className="size-10 rounded-md border bg-muted object-cover" />
      ) : (
        <Sparkles className="size-5 text-muted-foreground" />
      )}
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="line-clamp-2 w-full text-[11px] font-medium">{formatPlainValue(item.name ?? "-")}</div>
      {(item.level !== undefined || item.enchantLevel !== undefined) && (
        <Badge variant="secondary" className="text-[10px]">Lv.{formatPlainValue(item.level ?? item.enchantLevel)}</Badge>
      )}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function formatPlainValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("ko-KR") : value.toFixed(1);
  return String(value);
}

function formatPercent(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0%";
  return `${number.toFixed(0)}%`;
}

function formatCssPercent(value: unknown) {
  const number = Math.max(0, Math.min(100, Number(value ?? 0)));
  return `${Number.isFinite(number) ? number : 0}%`;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
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

function findDaevanionDetail(details: unknown[], boardId: unknown) {
  const id = String(boardId ?? "");
  if (!id) return undefined;
  for (const detail of details) {
    const record = asRecord(detail) ?? {};
    if (String(record.boardId ?? "") !== id) continue;
    return asRecord(record.data) ?? record;
  }
  return undefined;
}

function normalizeDaevanionNode(node: unknown): DaevanionNode {
  const record = asRecord(node) ?? {};
  return {
    name: String(record.name ?? ""),
    row: Number(record.row ?? 0),
    col: Number(record.col ?? 0),
    grade: String(record.grade ?? "Common"),
    type: String(record.type ?? ""),
    open: Boolean(record.open),
    effects: asArray(record.effects ?? record.effectList),
  };
}

function formatDaevanionNodeTitle(node: DaevanionNode) {
  const effects = node.effects
    .map((effect) => formatPlainValue(asRecord(effect)?.desc ?? effect))
    .filter((effect) => effect !== "-")
    .join(" / ");
  const title = node.name || node.type || "Node";
  return `${title}${node.open ? " (개방)" : " (미개방)"}${effects ? ` - ${effects}` : ""}`;
}

function getDaevanionNodeColor(grade: unknown) {
  const key = getGradeKey(grade);
  if (key === "epic") {
    return { bg: "rgba(249, 115, 22, 0.36)", border: "#fb923c", glow: "rgba(249, 115, 22, 0.48)" };
  }
  if (key === "unique") {
    return { bg: "rgba(250, 204, 21, 0.32)", border: "#facc15", glow: "rgba(250, 204, 21, 0.5)" };
  }
  if (key === "legend") {
    return { bg: "rgba(96, 165, 250, 0.34)", border: "#60a5fa", glow: "rgba(96, 165, 250, 0.5)" };
  }
  if (key === "rare") {
    return { bg: "rgba(74, 222, 128, 0.28)", border: "#4ade80", glow: "rgba(74, 222, 128, 0.42)" };
  }
  return { bg: "rgba(148, 163, 184, 0.24)", border: "#94a3b8", glow: "rgba(148, 163, 184, 0.28)" };
}

function formatScore(value: number | string | null | undefined) {
  return Number(value ?? 50).toFixed(1);
}
