"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RadioTower, ShieldCheck, Swords, Users } from "lucide-react";
import { AION2_CLASSES, type Dungeon } from "@/lib/aion2";
import { useFriendsContext } from "@/components/friends/friends-provider";
import type { Friend } from "@/hooks/use-friends";
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

type MatchStatus = {
  matched: boolean;
  roomCode?: string;
  active?: boolean;
  role?: "leader" | "member";
  waitingCount?: number;
  needed?: number;
  since?: string;
  status?: string;
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

function defaultMinCombatPowerK(value: number | null | undefined) {
  return Math.max(0, Math.floor(combatPowerToK(value) / 50) * 50);
}

function combatPowerFromK(value: number) {
  return Math.max(0, Math.trunc(value || 0) * 1000);
}

function createClassSlots(count: number) {
  return Array.from({ length: count }, () => "");
}

function createInviteSlots(count: number) {
  return Array.from({ length: count }, () => null as Friend | null);
}

async function requestMatch(body: {
  role: "leader" | "member";
  dungeonId: string;
  stage: number;
  minCombatPower?: number;
  requiredClasses?: string[];
  maxMembers?: number;
  characterId?: string;
  invitedFriendIds?: string[];
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

async function fetchMatchStatus(since: string) {
  const res = await fetch(`/api/matching?since=${encodeURIComponent(since)}`, {
    method: "GET",
  });
  if (!res.ok) return null;
  return (await res.json()) as MatchStatus;
}

async function cancelMatch() {
  const res = await fetch("/api/matching", { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "매칭 취소에 실패했습니다.");
  }
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
  const { friends } = useFriendsContext();
  const [mode, setMode] = useState<"leader" | "member">("member");
  const [dungeonId, setDungeonId] = useState(dungeons[0]?.id ?? "");
  const selectedDungeon = dungeons.find((d) => d.id === dungeonId);
  const savedStage = progress.find((item) => item.dungeonId === dungeonId)?.stage ?? 0;
  const primaryCharacter = characters.find((character) => character.isPrimary) ?? characters[0];
  const [characterId, setCharacterId] = useState(primaryCharacter?.id ?? "");
  const selectedCharacter = characters.find((character) => character.id === characterId);
  const [stage, setStage] = useState(savedStage);
  const [minCombatPowerK, setMinCombatPowerK] = useState(
    defaultMinCombatPowerK(selectedCharacter?.combatPower ?? profile?.combatPower),
  );
  const [requiredClasses, setRequiredClasses] = useState<string[]>(
    createClassSlots(memberSlotCountForDungeon(selectedDungeon)),
  );
  const [invitedSlots, setInvitedSlots] = useState<(Friend | null)[]>(
    createInviteSlots(memberSlotCountForDungeon(selectedDungeon)),
  );
  const [pending, setPending] = useState(false);
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const matchSessionStartedAt = useRef(new Date().toISOString());

  const maxMembers = partySizeForDungeon(selectedDungeon);
  const hasLinkedCharacter = characters.length > 0 || (!!profile?.charClass && !!profile.combatPower);
  const stages = ["처음", ...(selectedDungeon?.gimmick_stages ?? []), "클리어"];

  useEffect(() => {
    if (isGuest) return;

    let active = true;
    async function refreshStatus() {
      const status = await fetchMatchStatus(matchSessionStartedAt.current);
      if (!active || !status) return;

      if (status.matched && status.roomCode) {
        toast.success("파티가 매칭됐습니다. 방으로 이동합니다.");
        router.push(`/room/${status.roomCode}`);
        return;
      }

      setMatchStatus(status.active ? status : null);
    }

    void refreshStatus();
    const id = window.setInterval(refreshStatus, 3000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [isGuest, router]);

  function changeDungeon(nextDungeonId: string) {
    setDungeonId(nextDungeonId);
    const nextDungeon = dungeons.find((dungeon) => dungeon.id === nextDungeonId);
    const nextStage = progress.find((item) => item.dungeonId === nextDungeonId)?.stage ?? 0;
    setStage(nextStage);
    setRequiredClasses((current) => {
      const nextCount = memberSlotCountForDungeon(nextDungeon);
      return Array.from(
        { length: nextCount },
        (_, index) => current[index] ?? "",
      );
    });
    setInvitedSlots((current) => {
      const nextCount = memberSlotCountForDungeon(nextDungeon);
      return Array.from({ length: nextCount }, (_, index) => current[index] ?? null);
    });
  }

  function changeCharacter(nextCharacterId: string) {
    setCharacterId(nextCharacterId);
    const nextCharacter = characters.find(
      (character) => character.id === nextCharacterId,
    );
    if (!nextCharacter) return;
    setMinCombatPowerK(defaultMinCombatPowerK(nextCharacter.combatPower));
  }

  function changeClassSlot(index: number, className: string) {
    setRequiredClasses((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? className : item)),
    );
  }

  function assignFriendToSlot(index: number, friend: Friend | null) {
    setInvitedSlots((current) => {
      const next = current.map((item) =>
        item?.user_id === friend?.user_id ? null : item,
      );
      next[index] = friend;
      return next;
    });

    if (friend?.class_name) {
      changeClassSlot(index, friend.class_name);
    }
  }

  function moveFriendSlot(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setInvitedSlots((current) => {
      const next = [...current];
      const moving = next[fromIndex] ?? null;
      next[fromIndex] = next[toIndex] ?? null;
      next[toIndex] = moving;
      return next;
    });
    setRequiredClasses((current) => {
      const next = [...current];
      const moving = next[fromIndex] ?? "";
      next[fromIndex] = next[toIndex] ?? "";
      next[toIndex] = moving;
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dungeonId || pending) return;
    setPending(true);
    try {
      matchSessionStartedAt.current = new Date().toISOString();
      const invitedFriendIds = invitedSlots
        .map((friend) => friend?.user_id)
        .filter((id): id is string => !!id);
      const requiredClassesForMatching = requiredClasses.filter(
        (className, index) => !!className && !invitedSlots[index],
      );
      const result = await requestMatch({
        role: mode,
        dungeonId,
        characterId,
        stage,
        minCombatPower: combatPowerFromK(minCombatPowerK),
        requiredClasses: requiredClassesForMatching,
        maxMembers,
        invitedFriendIds,
      });

      if (result.matched && result.roomCode) {
        toast.success("파티가 매칭됐습니다. 방으로 이동합니다.");
        router.push(`/room/${result.roomCode}`);
        return;
      }

      setMatchStatus({
        matched: false,
        active: true,
        role: mode,
        waitingCount: result.waitingCount,
        needed: result.needed,
        since: new Date().toISOString(),
      });

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

  async function onCancelMatch() {
    setCancelling(true);
    try {
      await cancelMatch();
      setMatchStatus(null);
      toast.success("매칭 대기를 취소했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "매칭 취소에 실패했습니다.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
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
                  invitedSlots={invitedSlots}
                  friends={friends}
                  minCombatPower={combatPowerFromK(minCombatPowerK)}
                  onChange={changeClassSlot}
                  onAssignFriend={assignFriendToSlot}
                  onMoveFriend={moveFriendSlot}
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
      {matchStatus?.active && (
        <MatchFloatingStatus
          status={matchStatus}
          cancelling={cancelling}
          onCancel={onCancelMatch}
        />
      )}
    </>
  );
}

function MatchFloatingStatus({
  status,
  cancelling,
  onCancel,
}: {
  status: MatchStatus;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const isLeader = status.role === "leader";
  const waitingCount = status.waitingCount ?? 0;
  const needed = status.needed ?? 0;

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-lg border bg-card/95 p-4 text-card-foreground shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="size-4 animate-spin text-violet-400" />
            매칭 대기 중
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLeader
              ? `조건에 맞는 파티원을 찾는 중입니다. ${waitingCount}/${needed}명`
              : "조건에 맞는 파티가 열리면 자동으로 방에 입장합니다."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cancelling || status.status === "processing"}
          onClick={onCancel}
        >
          {cancelling && <Loader2 className="size-3.5 animate-spin" />}
          취소
        </Button>
      </div>
    </div>
  );
}

function ClassSlotBoard({
  dungeon,
  leaderClass,
  slots,
  invitedSlots,
  friends,
  minCombatPower,
  onChange,
  onAssignFriend,
  onMoveFriend,
}: {
  dungeon: Dungeon | undefined;
  leaderClass?: string | null;
  slots: string[];
  invitedSlots: (Friend | null)[];
  friends: Friend[];
  minCombatPower: number;
  onChange: (index: number, className: string) => void;
  onAssignFriend: (index: number, friend: Friend | null) => void;
  onMoveFriend: (fromIndex: number, toIndex: number) => void;
}) {
  const firstPartySlots = dungeon?.category === "성역" ? slots.slice(0, 4) : slots;
  const secondPartySlots = dungeon?.category === "성역" ? slots.slice(4, 9) : [];
  const firstPartyInvites =
    dungeon?.category === "성역" ? invitedSlots.slice(0, 4) : invitedSlots;
  const secondPartyInvites =
    dungeon?.category === "성역" ? invitedSlots.slice(4, 9) : [];
  const assignedIds = new Set(
    invitedSlots.map((friend) => friend?.user_id).filter(Boolean),
  );
  const availableFriends = friends.filter(
    (friend) => !assignedIds.has(friend.user_id),
  );

  return (
    <div className="grid gap-3">
      {availableFriends.length > 0 && (
        <div className="rounded-md border border-dashed p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            초대할 친구
          </div>
          <div className="flex flex-wrap gap-2">
            {availableFriends.map((friend) => (
              <button
                key={friend.user_id}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("friend-id", friend.user_id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-muted/50"
                title="슬롯으로 드래그해서 초대"
              >
                <span
                  className={`size-2 rounded-full ${
                    friend.is_online ? "bg-green-500" : "bg-muted-foreground/40"
                  }`}
                />
                <span>{friend.nickname}</span>
                {friend.class_name && (
                  <span className="text-muted-foreground">
                    {friend.class_name}
                    {friend.combat_power
                      ? ` ${formatCombatPower(friend.combat_power)}`
                      : ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      <ClassSlotGroup
        title={dungeon?.category === "성역" ? "1파티" : "1파티"}
        leaderClass={leaderClass}
        slots={firstPartySlots}
        invitedSlots={firstPartyInvites}
        friends={friends}
        minCombatPower={minCombatPower}
        offset={0}
        onChange={onChange}
        onAssignFriend={onAssignFriend}
        onMoveFriend={onMoveFriend}
      />
      {secondPartySlots.length > 0 && (
        <ClassSlotGroup
          title="2파티"
          slots={secondPartySlots}
          invitedSlots={secondPartyInvites}
          friends={friends}
          minCombatPower={minCombatPower}
          offset={4}
          onChange={onChange}
          onAssignFriend={onAssignFriend}
          onMoveFriend={onMoveFriend}
        />
      )}
    </div>
  );
}

function ClassSlotGroup({
  title,
  leaderClass,
  slots,
  invitedSlots,
  friends,
  minCombatPower,
  offset,
  onChange,
  onAssignFriend,
  onMoveFriend,
}: {
  title: string;
  leaderClass?: string | null;
  slots: string[];
  invitedSlots: (Friend | null)[];
  friends: Friend[];
  minCombatPower: number;
  offset: number;
  onChange: (index: number, className: string) => void;
  onAssignFriend: (index: number, friend: Friend | null) => void;
  onMoveFriend: (fromIndex: number, toIndex: number) => void;
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
        {slots.map((className, index) => {
          const globalIndex = offset + index;
          const invitedFriend = invitedSlots[index];
          const isUnderPower =
            !!invitedFriend?.combat_power &&
            invitedFriend.combat_power < minCombatPower;

          return (
            <div
              key={`${title}-${globalIndex}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const friendId = event.dataTransfer.getData("friend-id");
                const fromSlot = event.dataTransfer.getData("slot-index");
                if (fromSlot) {
                  onMoveFriend(Number(fromSlot), globalIndex);
                  return;
                }
                const friend = friends.find((item) => item.user_id === friendId);
                if (friend) onAssignFriend(globalIndex, friend);
              }}
              className={`rounded-md border p-2 ${
                invitedFriend ? "bg-muted/25" : "border-dashed"
              }`}
            >
              {invitedFriend ? (
                <div
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("slot-index", String(globalIndex));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  className="flex min-h-16 flex-col gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {invitedFriend.nickname}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(invitedFriend.class_name ?? className) || "직업 미연동"}
                        {invitedFriend.combat_power
                          ? ` · ${formatCombatPower(invitedFriend.combat_power)}`
                          : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="초대 친구 제거"
                      onClick={() => onAssignFriend(globalIndex, null)}
                    >
                      ×
                    </Button>
                  </div>
                  {isUnderPower && (
                    <span className="text-[11px] text-destructive">
                      최소투력 미달
                    </span>
                  )}
                </div>
              ) : (
                <select
                  value={className}
                  onChange={(e) => onChange(globalIndex, e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
              )}
            </div>
          );
        })}
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
