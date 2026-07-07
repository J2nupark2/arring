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
  const [minCombatPower, setMinCombatPower] = useState(
    selectedCharacter?.combatPower ?? profile?.combatPower ?? 0,
  );
  const [maxMembers, setMaxMembers] = useState(6);
  const [requiredClasses, setRequiredClasses] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const hasLinkedCharacter = characters.length > 0 || (!!profile?.charClass && !!profile.combatPower);
  const stages = useMemo(() => {
    const items = selectedDungeon?.gimmick_stages ?? [];
    return ["처음", ...items, "클리어"];
  }, [selectedDungeon]);

  function changeDungeon(nextDungeonId: string) {
    setDungeonId(nextDungeonId);
    const nextStage = progress.find((item) => item.dungeonId === nextDungeonId)?.stage ?? 0;
    setStage(nextStage);
  }

  function toggleClass(className: string) {
    setRequiredClasses((current) =>
      current.includes(className)
        ? current.filter((item) => item !== className)
        : [...current, className],
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
        minCombatPower,
        requiredClasses,
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
                onChange={(e) => {
                  setCharacterId(e.target.value);
                  const nextCharacter = characters.find(
                    (character) => character.id === e.target.value,
                  );
                  if (nextCharacter) setMinCombatPower(nextCharacter.combatPower);
                }}
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
                  <Label htmlFor="match-power">최소 투력</Label>
                  <Input
                    id="match-power"
                    type="number"
                    min={0}
                    step={1000}
                    value={minCombatPower}
                    onChange={(e) => setMinCombatPower(Number(e.target.value))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="match-size">파티 인원</Label>
                  <Input
                    id="match-size"
                    type="number"
                    min={2}
                    max={12}
                    value={maxMembers}
                    onChange={(e) => setMaxMembers(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>받을 클래스</Label>
                <div className="flex flex-wrap gap-2">
                  {AION2_CLASSES.map((className) => (
                    <Button
                      key={className}
                      type="button"
                      variant={requiredClasses.includes(className) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleClass(className)}
                    >
                      <Swords className="size-3.5" />
                      {className}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            <span>
              선택 진도: {stageLabel(selectedDungeon, stage)}
              {selectedCharacter?.className && ` · ${selectedCharacter.name} ${selectedCharacter.className}`}
              {selectedCharacter?.combatPower && ` · 투력 ${formatCombatPower(selectedCharacter.combatPower)}`}
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
