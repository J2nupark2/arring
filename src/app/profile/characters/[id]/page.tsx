import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Award,
  BarChart3,
  Gauge,
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
  const arcanaSet = equipment.find(
    (item) => String(item.slot ?? "").startsWith("Arcana") && item.set,
  )?.set;
  const statList = normalizeStatList(character.stat_list);
  const titles = normalizeTitleList(character.titles);
  const daevanion = normalizeDaevanionList(character.daevanion);

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

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.68fr)] 2xl:grid-cols-[minmax(0,1.18fr)_minmax(420px,0.72fr)]">
          <EquipmentBoard items={equipment} />
          <SkillBoard skills={skills} stigmas={stigmas} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <ArcanaCard set={arcanaSet} />
          <DaevanionCard boards={daevanion} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <TitleCard titles={titles} />
          <StatBoard statList={statList} />
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

type NamedStat = { name: string; value?: string | number; extra?: string | number };
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

function ArcanaCard({ set }: { set: ArcanaSetBonus | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4" />
          아르카나 세트 효과
        </CardTitle>
        {set?.name && (
          <CardDescription>
            {set.name} · {set.equippedCount ?? 0}세트 장착
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {!set || set.bonuses.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            아르카나 세트 정보가 없어요.
          </p>
        ) : (
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
                {title.grade && <Badge variant="secondary">{title.grade}</Badge>}
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
              +{item.level}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {item.slot && <span>{formatCategory(item.slot)}</span>}
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
          <StatLine title="기본 옵션" stats={item.mainStats} />
          <StatLine title="영혼 각인" stats={item.subStats} />
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
          <StatLine title="마석 각인" stats={item.magicStoneStat} />
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

function StatLine({ title, stats }: { title: string; stats?: NamedStat[] }) {
  if (!stats || stats.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground">{title}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {stats.map((stat, index) => (
          <span key={`${stat.name}-${index}`}>
            {stat.name}
            {stat.value !== undefined ? ` ${signed(stat.value)}` : ""}
            {stat.extra ? ` (${signed(stat.extra)})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function signed(value: string | number) {
  const text = String(value);
  return /^[+-]/.test(text) ? text : `+${text}`;
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

function isSlotMatch(item: DetailItem, aliases: readonly string[]) {
  const text = `${item.slot ?? ""} ${item.name}`.toLowerCase();
  return aliases.some((alias) => text.includes(alias.toLowerCase()));
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
  arcana1: "아르카나1",
  arcana2: "아르카나2",
  arcana3: "아르카나3",
  arcana4: "아르카나4",
  arcana5: "아르카나5",
  arcana6: "아르카나6",
  arcana7: "아르카나7",
  arcana8: "아르카나8",
};

function formatCategory(value: string | number) {
  const category = String(value);
  if (category.toLowerCase() === "active") return "액티브";
  if (category.toLowerCase() === "passive") return "패시브";
  if (category.toLowerCase() === "dp") return "스티그마";
  return SLOT_NAME_KO[category.toLowerCase()] ?? category;
}
