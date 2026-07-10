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
  const equipment = normalizeList(character.equipment);
  const skills = normalizeList(describedSkills);
  const stigmas = normalizeList(describedStigmas);

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

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
          <EquipmentBoard
            items={equipment}
            characterName={character.character_name}
            serverName={character.server_name}
            className={character.class_name}
            level={character.character_level}
            combatPower={character.combat_power}
            isPrimary={character.is_primary}
          />
          <div className="space-y-5">
            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-muted/35 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
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
                  <div className="rounded-md border bg-background px-4 py-3 text-right">
                    <div className="text-xs font-medium text-muted-foreground">
                      전투력
                    </div>
                    <div className="font-mono text-3xl font-bold text-primary">
                      {formatCombatPower(character.combat_power)}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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

            <SkillBoard skills={skills} stigmas={stigmas} />
            <CharacterStatsCard detailData={detailData} />
            <CompanionCard detailData={detailData} />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <RankingCard detailData={detailData} />
          <DaevanionCard detailData={detailData} />
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
  detail?: unknown;
};

function EquipmentBoard({
  items,
  characterName,
  serverName,
  className,
  level,
  combatPower,
  isPrimary,
}: {
  items: DetailItem[];
  characterName: string;
  serverName?: string | null;
  className?: string | null;
  level?: string | number | null;
  combatPower?: number | null;
  isPrimary?: boolean | null;
}) {
  const usedIndexes = new Set<number>();
  const slotted = EQUIPMENT_SLOTS.map((slot) => {
    const index = items.findIndex(
      (item, itemIndex) =>
        !usedIndexes.has(itemIndex) && isSlotMatch(item, slot.aliases),
    );
    if (index >= 0) {
      usedIndexes.add(index);
      return { key: slot.key, slot: slot.label, item: items[index] };
    }
    return { key: slot.key, slot: slot.label, item: undefined };
  });
  const extras = items.filter((_, index) => !usedIndexes.has(index));
  const slotMap = new Map<string, (typeof slotted)[number]>(
    slotted.map((slot) => [slot.key, slot]),
  );
  const leftSlots = ["weapon", "helmet", "gloves", "ring"] as const;
  const rightSlots = ["subWeapon", "armor", "shoes", "earring"] as const;
  const bottomSlots = ["necklace", "belt", "pants", "wing"] as const;

  return (
    <Card className="overflow-visible">
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4" />
              장비 정보
            </CardTitle>
            <CardDescription>
              아툴처럼 캐릭터를 중심에 두고 장착 슬롯을 배치했어요.
            </CardDescription>
          </div>
          <Badge variant="outline">{items.length}개 확인</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(148px,0.72fr)_minmax(220px,1fr)_minmax(148px,0.72fr)]">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {leftSlots.map((key) => (
              <EquipmentSlotCard key={key} slot={slotMap.get(key)} />
            ))}
          </div>

          <div className="relative flex min-h-[360px] flex-col justify-between overflow-hidden rounded-md border bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-bold">{characterName}</span>
                  {isPrimary && <Badge variant="secondary">대표</Badge>}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {serverName || "서버 미확인"} · {className || "직업 미확인"} · Lv.{level ?? "-"}
                </div>
              </div>
              <div className="rounded-md border bg-background/80 px-3 py-2 text-right backdrop-blur">
                <div className="text-[11px] font-medium text-muted-foreground">전투력</div>
                <div className="font-mono text-2xl font-bold text-primary">
                  {formatCombatPower(combatPower)}
                </div>
              </div>
            </div>

            <div className="mx-auto flex size-44 items-center justify-center rounded-full border border-primary/25 bg-background/55 shadow-[0_0_70px_rgba(139,92,246,0.18)]">
              <div className="flex size-28 items-center justify-center rounded-full border bg-muted/40 text-5xl font-black text-primary/80">
                {characterName.slice(0, 1)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <SpecPill label="장착" value={items.length + "개"} />
              <SpecPill label="레벨" value={"Lv." + (level ?? "-")} />
              <SpecPill label="서버" value={serverName || "-"} />
              <SpecPill label="클래스" value={className || "-"} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {rightSlots.map((key) => (
              <EquipmentSlotCard key={key} slot={slotMap.get(key)} />
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {bottomSlots.map((key) => (
            <EquipmentSlotCard key={key} slot={slotMap.get(key)} compact />
          ))}
        </div>

        {extras.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              기타 장비
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {extras.map((item, index) => (
                <EquipmentSlotCard
                  key={item.name + "-" + index}
                  slot={{ slot: "기타", item }}
                  compact
                />
              ))}
            </div>
          </div>
        )}

        {items.length === 0 && (
          <p className="mt-4 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            공식 정보실 응답에 장비 목록이 없어서 슬롯 자리만 먼저 표시하고 있어요. 다음 동기화에서 장비 데이터가 들어오면 자동으로 채워져요.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentSlotCard({
  slot,
  compact = false,
}: {
  slot?: { slot: string; item?: DetailItem };
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
            {slot.item.grade}
          </span>
        )}
      </div>
      {slot?.item ? (
        <ItemSummary item={slot.item} compact={compact} />
      ) : (
        <div className="flex min-h-10 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
          정보 없음
        </div>
      )}
    </div>
  );
}

function SpecPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/70 px-3 py-2">
      <div className="text-[11px] font-medium">{label}</div>
      <div className="mt-0.5 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function CharacterStatsCard({ detailData }: { detailData?: Record<string, unknown> }) {
  const stats = asArray(detailData?.stats).slice(0, 10);
  const summary = asRecord(detailData?.summary);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{"\uc2a4\ud0ef \uc694\uc57d"}</CardTitle>
        <CardDescription>{"\uacf5\uc2dd \uc815\ubcf4\uc2e4\uc758 \uc8fc\uc694 \ub2a5\ub825\uce58\ub97c \uc815\ub9ac\ud588\uc5b4\uc694."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <SpecPill label="Item Lv" value={formatPlainValue(summary?.itemLevel ?? "-")} />
          <SpecPill label="Skills" value={formatPlainValue(summary?.skillCount ?? "-")} />
          <SpecPill label="Equipped" value={formatPlainValue(summary?.equippedSkillCount ?? "-")} />
          <SpecPill label="Daeva" value={formatPercent(summary?.daevanionOpenAverage)} />
        </div>
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
      <CardContent className="space-y-2">
        {entries.length > 0 ? entries.map((entry) => (
          <IconInfoRow key={entry.label} label={entry.label} item={entry.item!} />
        )) : <EmptyText>{"\ud3ab/\ub0a0\uac1c \uc815\ubcf4\uac00 \uc544\uc9c1 \uc5c6\uc5b4\uc694."}</EmptyText>}
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

function ItemSummary({
  item,
  compact = false,
}: {
  item: DetailItem;
  compact?: boolean;
}) {
  const hasTooltip = hasSkillTooltip(item);
  const hasEquipmentTooltip = hasEquipmentDetailTooltip(item);
  const gradeColor = getEquipmentGradeColor(item);

  return (
    <div className="group relative z-0 flex min-w-0 gap-2 hover:z-50">
      {item.icon && (
        // Official AION2 item and skill icons are small CDN assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.icon}
          alt=""
          className={(compact ? "size-8" : "size-9") + " shrink-0 rounded-md border bg-muted object-cover"}
          style={{ borderColor: `${gradeColor}88` }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className={(compact ? "text-sm " : "") + "min-w-0 break-words font-medium"}>{item.name}</span>
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
        <ItemStatPreview item={item} />
        <ItemOptionPreview item={item} />
      </div>
      {hasTooltip && <SkillTooltip item={item} />}
      {hasEquipmentTooltip && <EquipmentTooltip item={item} />}
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
  if (title === "???? ??") {
    return getSoulTierColor(getSoulInscriptionTier(record.name));
  }
  if (title === "??" || title === "??") {
    return getOptionGradeColor(record.grade);
  }
  return undefined;
}

function getOptionGradeColor(grade: unknown) {
  const value = String(grade ?? "").toLowerCase();
  if (value.includes("legend")) return "#4a90e2";
  if (value.includes("epic")) return "#FF6B35";
  if (value.includes("unique")) return "#FFD700";
  if (value.includes("rare")) return "#4caf50";
  return undefined;
}


function getEquipmentGradeColor(item: DetailItem) {
  const detail = asRecord(item.detail);
  const grade = String(detail?.grade ?? item.grade ?? "").toLowerCase();
  if (grade.includes("epic")) return "#FF6B35";
  if (grade.includes("unique")) return "#FFD700";
  if (grade.includes("legend")) return "#4a90e2";
  if (grade.includes("rare")) return "#4caf50";
  return "#8b5cf6";
}

function getSoulInscriptionTier(optionName: unknown) {
  if (!optionName) return "C";
  const name = String(optionName).trim();
  const sTierOptions = ["?? ?? ??", "?? ??", "?? ??", "??? ?? ??", "??", "?? ?? ??", "??"];
  const bTierOptions = ["??", "??", "??", "???", "?? ???", "?? ??", "???", "??? ??", "?? ???", "???", "??? ??", "?? ??", "?? ??", "???? ??", "???? ??", "?? ??", "?? ??", "??", "??"];
  const aTierOptions = ["?? ??", "???", "??? ??", "??", "???", "??"];
  if (sTierOptions.some((option) => name.includes(option))) return "S";
  if (bTierOptions.some((option) => name.includes(option))) return "B";
  if (aTierOptions.some((option) => name === option || name.includes(option))) return "A";
  return "B";
}

function getSoulTierColor(tier: string) {
  if (tier === "S") return "#facc15";
  if (tier === "A") return "#60a5fa";
  if (tier === "B") return "#4ade80";
  return "#888888";
}


function ItemOptionPreview({ item }: { item: DetailItem }) {
  const detail = asRecord(item.detail);
  if (!detail) return null;

  const magicStones = asArray(detail.magicStoneStat);
  const godStones = asArray(detail.godStoneStat);
  const subSkills = asArray(detail.subSkills);
  const lines = [
    detail.soulBindRate !== undefined ? `영혼각인 ${formatPlainValue(detail.soulBindRate)}%` : "",
    magicStones.length > 0
      ? `마석 ${magicStones.length}/${formatPlainValue(detail.magicStoneSlotCount ?? magicStones.length)}`
      : "",
    godStones.length > 0 ? `신석 ${formatPlainValue(asRecord(godStones[0])?.name ?? godStones.length)}` : "",
    subSkills.length > 0 ? `장비 스킬 ${subSkills.length}` : "",
  ].filter(Boolean).slice(0, 3);

  if (lines.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {lines.map((line) => (
        <span key={line} className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] leading-4 text-primary">
          {line}
        </span>
      ))}
    </div>
  );
}

function EquipmentTooltip({ item }: { item: DetailItem }) {
  const detail = asRecord(item.detail);
  if (!detail) return null;

  const gradeColor = getEquipmentGradeColor(item);
  const mainStats = asArray(detail.mainStats);
  const subStats = asArray(detail.subStats);
  const magicStones = asArray(detail.magicStoneStat);
  const godStones = asArray(detail.godStoneStat);
  const subSkills = asArray(detail.subSkills);

  return (
    <div
      className="pointer-events-none absolute left-0 top-12 z-50 hidden w-[26rem] max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-3 text-popover-foreground shadow-xl group-hover:block"
      style={{ borderColor: `${gradeColor}88`, boxShadow: `0 18px 60px ${gradeColor}22` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold">{item.name}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {item.slot && <span>{item.slot}</span>}
            {detail.gradeName !== undefined && <span style={{ color: gradeColor }}>{formatPlainValue(detail.gradeName)}</span>}
            {detail.categoryName !== undefined && <span>{formatPlainValue(detail.categoryName)}</span>}
            {detail.soulBindRate !== undefined && <span>영혼각인 {formatPlainValue(detail.soulBindRate)}%</span>}
          </div>
        </div>
        {detail.enchantLevel !== undefined && (
          <Badge variant="secondary">+{formatPlainValue(detail.enchantLevel)}</Badge>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <OptionSection title="주 능력치" items={mainStats} />
        <OptionSection title="영혼각인 옵션" items={subStats} />
        <OptionSection title="마석" items={magicStones} icon />
        <OptionSection title="신석" items={godStones} icon description />
        <OptionSection title="장비 스킬" items={subSkills} icon level />
      </div>
    </div>
  );
}

function OptionSection({
  title,
  items,
  icon = false,
  description = false,
  level = false,
}: {
  title: string;
  items: unknown[];
  icon?: boolean;
  description?: boolean;
  level?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded border bg-background/60 p-2">
      <div className="text-[11px] font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-1">
        {items.slice(0, 8).map((item, index) => {
          const record = asRecord(item) ?? {};
          const name = formatPlainValue(record.name ?? record.id ?? "-");
          const value = record.value !== undefined ? formatPlainValue(record.value) : "";
          const accentColor = getOptionAccentColor(title, record);
          return (
            <div
              key={`${title}-${index}`}
              className="flex min-w-0 items-start gap-2 rounded-sm border-l-2 px-2 py-1 text-xs"
              style={{
                borderLeftColor: accentColor ?? "transparent",
                backgroundColor: accentColor ? `${accentColor}12` : undefined,
              }}
            >
              {icon && typeof record.icon === "string" && record.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={record.icon}
                  alt=""
                  className="mt-0.5 size-5 shrink-0 rounded border bg-muted object-cover"
                  style={accentColor ? { borderColor: `${accentColor}aa` } : undefined}
                />
              ) : null}
              {!icon && accentColor && (
                <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate" style={accentColor && title === "???? ??" ? { color: accentColor } : undefined}>{name}</span>
                  {record.grade !== undefined && title !== "영혼각인 옵션" && (
                    <span className="shrink-0 text-[10px] font-medium" style={{ color: accentColor }}>
                      {formatPlainValue(record.grade)}
                    </span>
                  )}
                  {value && <span className="shrink-0 font-medium" style={accentColor ? { color: accentColor } : undefined}>{value}</span>}
                  {level && record.level !== undefined && <span className="shrink-0 text-muted-foreground">Lv.{formatPlainValue(record.level)}</span>}
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

function ItemStatPreview({ item }: { item: DetailItem }) {
  const lines = getItemStatLines(item).slice(0, 2);
  if (lines.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
      {lines.map((line) => (
        <div key={line} className="truncate">{line}</div>
      ))}
    </div>
  );
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

function IconInfoRow({ label, item }: { label: string; item: Record<string, unknown> }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
      {typeof item.icon === "string" && item.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.icon} alt="" className="size-10 rounded-md border bg-muted object-cover" />
      ) : (
        <Sparkles className="size-5 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{formatPlainValue(item.name ?? "-")}</div>
      </div>
      {(item.level !== undefined || item.enchantLevel !== undefined) && (
        <Badge variant="secondary">Lv.{formatPlainValue(item.level ?? item.enchantLevel)}</Badge>
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

function getItemStatLines(item: DetailItem) {
  const detail = asRecord(item.detail);
  const mainStats = asArray(detail?.mainStats);
  const subStats = asArray(detail?.subStats);
  return [...mainStats, ...subStats]
    .map((stat) => {
      const record = asRecord(stat);
      if (!record) return "";
      const name = pickText(record, ["name", "type", "id"]);
      const value = pickText(record, ["value", "minValue", "extra"]);
      if (!name || value === undefined) return "";
      return `${formatPlainValue(name)} ${formatPlainValue(value)}`;
    })
    .filter(Boolean);
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

function isSlotMatch(item: DetailItem, aliases: readonly string[]) {
  const text = `${item.slot ?? ""} ${item.name}`.toLowerCase();
  return aliases.some((alias) => text.includes(alias.toLowerCase()));
}

function formatScore(value: number | string | null | undefined) {
  return Number(value ?? 50).toFixed(1);
}

function hasEquipmentDetailTooltip(item: DetailItem) {
  const detail = asRecord(item.detail);
  return !!detail && (
    asArray(detail.mainStats).length > 0 ||
    asArray(detail.subStats).length > 0 ||
    asArray(detail.magicStoneStat).length > 0 ||
    asArray(detail.godStoneStat).length > 0 ||
    asArray(detail.subSkills).length > 0 ||
    detail.soulBindRate !== undefined
  );
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
