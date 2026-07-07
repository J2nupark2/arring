"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RadioTower, ShieldCheck, Swords, Users } from "lucide-react";
import { AION2_CLASSES, type Dungeon } from "@/lib/aion2";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCombatPower } from "@/lib/format";

type Profile = {
  charClass: string | null;
  combatPower: number | null;
  mannerTemperature: number | null;
  trustTemperature: number | null;
};

type Progress = {
  dungeonId: string;
  stage: number;
};

type MatchCharacter = {
  id: string;
  name: string;
  server: string;
  className: string;
  combatPower: number;
  isPrimary: boolean;
};

function stageLabel(dungeon: Dungeon | undefined, stage: number) {
  if (!dungeon || stage <= 0) return "처음";
  return dungeon.gimmick_stages[stage - 1] ?? "클리어";
}

function partySizeForDungeon(dungeon: Dungeon | undefined) {
  return dungeon?.category === "성역" ? 10 : 5;
}

function memberSlotCountForDungeon(dungeon: Dungeon | undefined) {
  return Math.max(0, partySizeForDungeon(dungeon) - 1);
}

function combatPowerToK(value: number | null | undefined) {
  return Math.max(0, Math.floor((Number(value) || 0) / 1000));
}

function combatPowerFromK(value: number) {
  return Math.max(0, Math.trunc(value || 0) * 1000);
}

function createClassSlots(count: number, preferredClass?: string | null) {
  return Array.from({ length: count }, () => preferredClass ?? "");
}

async function requestMatch(body: {
  role: "leader" | "member";
  dungeonId: string;
  stage: number;
  minCombatPower?: number;
  requiredClasses?: string[];
  maxMembers?: number;
  characterId?: string;
}) {
  const res = await fetch("/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "매칭 요청에 실패했습니다.");
  return data as { matched: boolean; roomCode?: string; waitingCount?: number; needed?: number };
}

export function MatchingPanel({
  dungeons,
  profile,
  progress,
  characters,
  isGuest,
}: {
  dungeons: Dungeon[];
  profile: Profile | null;
  progress: Progress[];
  characters: MatchCharacter[];
  isGuest: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"leader" | "member">("member");
  const [dungeonId, setDungeonId] = useState(dungeons[0]?.id ?? "");
  const selectedDungeon = dungeons.find((d) => d.id === dungeonId);
  const savedStage = progress.find((item) => item.dungeonId === dungeonId)?.stage ?? 0;
  const primaryCharacter = characters.find((character) => character.isPrimary) ?? characters[0];
  const [characterId, setCharacterId] = useState(primaryCharacter?.id ?? "");
  const selectedCharacter = characters.find((character) => character.id === characterId);
  const [stage, setStage] = useState(savedStage);
  const [minCombatPowerK, setMinCombatPowerK] = useState(
    combatPowerToK(selectedCharacter?.combatPower ?? profile?.combatPower),
  );
  const [requiredClasses, setRequiredClasses] = useState<string[]>(
    createClassSlots(memberSlotCountForDungeon(selectedDungeon), selectedCharacter?.className),
  );
  const [pending, setPending] = useState(false);

  const maxMembers = partySizeForDungeon(selectedDungeon);
  const hasLinkedCharacter = characters.length > 0 || (!!profile?.charClass && !!profile.combatPower);
  const stages = useMemo(() => {
    const items = selectedDungeon?.gimmick_stages ?? [];
    return ["처음", ...items, "클리어"];
  }, [selectedDungeon]);

  function changeDungeon(nextDungeonId: string) {
    setDungeonId(nextDungeonId);
    const nextDungeon = dungeons.find((dungeon) => dungeon.id === nextDungeonId);
    const nextStage = progress.find((item) => item.dungeonId === nextDungeonId)?.stage ?? 0;
    setStage(nextStage);
    setRequiredClasses((current) => {
      const nextCount = memberSlotCountForDungeon(nextDungeon);
      return Array.from(
        { length: nextCount },
        (_, index) => current[index] ?? selectedCharacter?.className ?? "",
      );
    });
  }

  function changeCharacter(nextCharacterId: string) {
    setCharacterId(nextCharacterId);
    const nextCharacter = characters.find(
      (character) => character.id === nextCharacterId,
    );
    if (!nextCharacter) return;
    setMinCombatPowerK(combatPowerToK(nextCharacter.combatPower));
  }

  function changeClassSlot(index: number, className: string) {
    setRequiredClasses((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? className : item)),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dungeonId || pending) return;
    setPending(true);
    try {
      const result = await requestMatch({
        role: mode,
        dungeonId,
        characterId,
        stage,
        minCombatPower: combatPowerFromK(minCombatPowerK),
        requiredClasses: requiredClasses.filter(Boolean),
        maxMembers,
      });

      if (result.matched && result.roomCode) {
        toast.success("파티가 매칭됐습니다. 방으로 이동합니다.");
        router.push(`/room/${result.roomCode}`);
        return;
      }

      if (mode === "leader") {
        toast.success(
          `매칭 요청을 열었습니다. 현재 조건 충족 대기 ${result.waitingCount ?? 0}/${result.needed ?? maxMembers - 1}명`,
        );
      } else {
        toast.success("대기열에 등록했습니다. 조건이 맞는 파티가 생기면 자동으로 연결됩니다.");
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "매칭 요청에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RadioTower className="size-5 text-violet-400" />
              아이온2 자동매칭
            </CardTitle>
            <CardDescription>
              파티장은 조건을 정하고, 파티원은 진도만 선택하면 온도와 조건을 기준으로 자동 배치됩니다.
            </CardDescription>
          </div>
          {profile && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">매너 {profile.mannerTemperature?.toFixed(1) ?? "36.5"}°</Badge>
              <Badge variant="outline">신뢰 {profile.trustTemperature?.toFixed(1) ?? "36.5"}°</Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {isGuest && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span>자동매칭은 평가와 캐릭터 연동이 필요해서 회원만 이용할 수 있어요.</span>
            <LinkButton href="/signup" variant="outline">회원가입</LinkButton>
          </div>
        )}

        {!isGuest && !hasLinkedCharacter && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm">
            <span>투력을 속일 수 없도록 공식 홈페이지 캐릭터 연동이 먼저 필요합니다.</span>
            <LinkButton href="/profile" variant="outline">캐릭터 연동</LinkButton>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode("member")}
            aria-pressed={mode === "member"}
            className={`rounded-md border px-3 py-3 text-left transition-colors ${
              mode === "member" ? "border-violet-500 bg-violet-500/10" : "hover:bg-muted/50"
            }`}
          >
            <HeadsetLabel icon={<Users className="size-4" />} title="파티원" body="내 진도를 기준으로 자동 대기" />
          </button>
          <button
            type="button"
            onClick={() => setMode("leader")}
            aria-pressed={mode === "leader"}
            className={`rounded-md border px-3 py-3 text-left transition-colors sm:col-span-2 ${
              mode === "leader" ? "border-violet-500 bg-violet-500/10" : "hover:bg-muted/50"
            }`}
          >
            <HeadsetLabel icon={<ShieldCheck className="size-4" />} title="파티장" body="리딩 가능, 조합과 투력 조건 설정" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="match-character">매칭 캐릭터</Label>
              <select
                id="match-character"
                value={characterId}
                onChange={(e) => changeCharacter(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {characters.length === 0 && (
                  <option value="" className="bg-popover">
                    캐릭터 없음
                  </option>
                )}
                {characters.map((character) => (
                  <option key={character.id} value={character.id} className="bg-popover">
                    {character.name} · {character.className}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="match-dungeon">콘텐츠</Label>
              <select
                id="match-dungeon"
                value={dungeonId}
                onChange={(e) => changeDungeon(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {dungeons.map((dungeon) => (
                  <option key={dungeon.id} value={dungeon.id} className="bg-popover">
                    [{dungeon.category}] {dungeon.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="match-stage">
                {mode === "leader" ? "요구 진도" : "내 기믹 진도"}
              </Label>
              <select
                id="match-stage"
                value={stage}
                onChange={(e) => setStage(Number(e.target.value))}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {stages.map((label, index) => (
                  <option key={label + index} value={index} className="bg-popover">
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {mode === "leader" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="match-power">최소 투력 (k)</Label>
                  <div className="relative">
                    <Input
                      id="match-power"
                      type="number"
                      min={0}
                      step={1}
                      value={minCombatPowerK}
                      onChange={(e) => setMinCombatPowerK(Number(e.target.value))}
                      className="pr-10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      k
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="match-size">파티 인원</Label>
                  <Input
                    id="match-size"
                    readOnly
                    value={maxMembers}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>받을 클래스</Label>
                <ClassSlotBoard
                  dungeon={selectedDungeon}
                  leaderClass={selectedCharacter?.className}
                  slots={requiredClasses}
                  onChange={changeClassSlot}
                />
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            <span>
              선택 진도: {stageLabel(selectedDungeon, stage)}
              {selectedCharacter?.className && ` · ${selectedCharacter.name} ${selectedCharacter.className}`}
              {selectedCharacter?.combatPower && ` · 투력 ${formatCombatPower(selectedCharacter.combatPower)}`}
              {mode === "leader" && ` · 최소 ${minCombatPowerK.toLocaleString()}k · ${maxMembers}명 고정`}
            </span>
            <Button type="submit" disabled={pending || isGuest || !hasLinkedCharacter || !characterId || dungeons.length === 0}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {mode === "leader" ? "매칭 열기" : "자동매칭 대기"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ClassSlotBoard({
  dungeon,
  leaderClass,
  slots,
  onChange,
}: {
  dungeon: Dungeon | undefined;
  leaderClass?: string | null;
  slots: string[];
  onChange: (index: number, className: string) => void;
}) {
  const firstPartySlots = dungeon?.category === "성역" ? slots.slice(0, 4) : slots;
  const secondPartySlots = dungeon?.category === "성역" ? slots.slice(4, 9) : [];

  return (
    <div className="grid gap-3">
      <ClassSlotGroup
        title={dungeon?.category === "성역" ? "1파티" : "1파티"}
        leaderClass={leaderClass}
        slots={firstPartySlots}
        offset={0}
        onChange={onChange}
      />
      {secondPartySlots.length > 0 && (
        <ClassSlotGroup
          title="2파티"
          slots={secondPartySlots}
          offset={4}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function ClassSlotGroup({
  title,
  leaderClass,
  slots,
  offset,
  onChange,
}: {
  title: string;
  leaderClass?: string | null;
  slots: string[];
  offset: number;
  onChange: (index: number, className: string) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Swords className="size-4 text-violet-400" />
          {title}
        </span>
        <Badge variant="secondary">{leaderClass ? slots.length + 1 : slots.length}명</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        {leaderClass && (
          <div className="flex h-9 items-center rounded-md border border-violet-500/40 bg-violet-500/10 px-3 text-sm">
            방장 · {leaderClass}
          </div>
        )}
        {slots.map((className, index) => (
          <select
            key={`${title}-${offset + index}`}
            value={className}
            onChange={(e) => onChange(offset + index, e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`${title} ${index + 1}번 받을 클래스`}
          >
            <option value="" className="bg-popover">
              자유
            </option>
            {AION2_CLASSES.map((aionClass) => (
              <option key={aionClass} value={aionClass} className="bg-popover">
                {aionClass}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  );
}

function HeadsetLabel({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{body}</span>
    </span>
  );
}
