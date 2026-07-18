"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { ChevronDown, Loader2, RadioTower, ShieldCheck, Swords, Users } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";
import type { MatchStatus } from "@/components/matching-floating-status";

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

const CONTENT_CATEGORIES = ["원정", "초월", "성역"] as const;

async function requestMatch(body: {
  role: "leader" | "member";
  dungeonId: string;
  stage: number;
  minCombatPower?: number;
  requiredClasses?: string[];
  maxMembers?: number;
  characterId?: string;
  invitedFriendIds?: string[];
  draftId?: string;
  canAutoLead?: boolean;
  autoLeadAfterSeconds?: number;
  allowConditionRelaxation?: boolean;
}) {
  const res = await fetch("/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "매칭 요청에 실패했습니다.");
  return data as MatchStatus;
}

async function sendMatchingInvite(body: {
  draftId: string;
  receiverId: string;
  dungeonId: string;
  stage: number;
  minCombatPower: number;
  maxMembers: number;
  characterId?: string;
  requiredClasses: string[];
}) {
  const res = await fetch("/api/matching/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "파티 초대에 실패했습니다.");
  return data as {
    inviteStatus: NonNullable<MatchStatus["inviteStatuses"]>[number];
  };
}

async function fetchDraftInviteStatuses(draftId: string) {
  const res = await fetch(`/api/matching/invites?draftId=${encodeURIComponent(draftId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.inviteStatuses ?? []) as NonNullable<MatchStatus["inviteStatuses"]>;
}

function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
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
  const searchParams = useSearchParams();
  const matchingDraftParam = searchParams.get("matchingDraft");
  const { friends } = useFriendsContext();
  const [mode, setMode] = useState<"leader" | "member">("member");
  const [dungeonId, setDungeonId] = useState(dungeons[0]?.id ?? "");
  const selectedDungeon = dungeons.find((d) => d.id === dungeonId);
  const [contentPickerOpen, setContentPickerOpen] = useState(false);
  const [contentCategory, setContentCategory] = useState(
    selectedDungeon?.category ?? CONTENT_CATEGORIES[0],
  );
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
  const [canAutoLead, setCanAutoLead] = useState(false);
  const [autoLeadAfterSeconds, setAutoLeadAfterSeconds] = useState(90);
  const [allowConditionRelaxation, setAllowConditionRelaxation] = useState(false);
  const [pending, setPending] = useState(false);
  const [localInviteStatuses, setLocalInviteStatuses] = useState<MatchStatus["inviteStatuses"]>([]);
  const [inviteDraftId, setInviteDraftId] = useState(
    () => matchingDraftParam ?? crypto.randomUUID(),
  );
  const [matchingWaitingRoomDraftId, setMatchingWaitingRoomDraftId] = useState<string | null>(
    () => matchingDraftParam,
  );
  const currentInviteDraftId = matchingDraftParam ?? inviteDraftId;
  const isMatchingWaitingRoom =
    !!matchingDraftParam || matchingWaitingRoomDraftId === currentInviteDraftId;

  const maxMembers = partySizeForDungeon(selectedDungeon);
  const slottedFriendIds = invitedSlots
    .map((friend) => friend?.user_id)
    .filter((id): id is string => !!id);
  const currentInviteStatusByUser = new Map(
    (localInviteStatuses ?? []).map((status) => [status.userId, status.status]),
  );
  const hasUnreadyInvitedFriends =
    mode === "leader" &&
    slottedFriendIds.some(
      (userId) => currentInviteStatusByUser.get(userId) !== "accepted",
    );
  const hasLinkedCharacter = characters.length > 0 || (!!profile?.charClass && !!profile.combatPower);
  const stages = ["처음", ...(selectedDungeon?.gimmick_stages ?? []), "클리어"];
  const contentCategories = [
    ...CONTENT_CATEGORIES,
    ...dungeons
      .map((dungeon) => dungeon.category)
      .filter(
        (category, index, categories) =>
          !CONTENT_CATEGORIES.some((item) => item === category) &&
          categories.indexOf(category) === index,
      ),
  ];
  const categoryDungeons = dungeons
    .filter((dungeon) => dungeon.category === contentCategory)
    .sort(
      (a, b) =>
        (b.tier ?? 1) - (a.tier ?? 1) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, "ko"),
    );
  const categoryDungeonGroups = [
    ...new Set(categoryDungeons.map((dungeon) => dungeon.tier ?? 1)),
  ]
    .sort((a, b) => b - a)
    .map((tier) => ({
      tier,
      dungeons: categoryDungeons.filter(
        (dungeon) => (dungeon.tier ?? 1) === tier,
      ),
    }));

  useEffect(() => {
    if (isGuest || mode !== "leader" || slottedFriendIds.length === 0) return;

    let active = true;
    async function refreshInviteStatuses() {
      const statuses = await fetchDraftInviteStatuses(currentInviteDraftId);
      if (!active || statuses.length === 0) return;
      setLocalInviteStatuses(statuses);
    }

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;

    void refreshInviteStatuses();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !active) return;
      channel = supabase
        .channel(`draft-invites:${currentInviteDraftId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "matching_invites",
            filter: `sender_id=eq.${user.id}`,
          },
          () => {
            void refreshInviteStatuses();
          },
        )
        .subscribe();
    });

    return () => {
      active = false;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [currentInviteDraftId, isGuest, mode, slottedFriendIds.length]);

  function changeDungeon(nextDungeonId: string) {
    setDungeonId(nextDungeonId);
    const nextDungeon = dungeons.find((dungeon) => dungeon.id === nextDungeonId);
    if (nextDungeon?.category) setContentCategory(nextDungeon.category);
    setContentPickerOpen(false);
    const nextDraftId = crypto.randomUUID();
    setInviteDraftId(nextDraftId);
    setMatchingWaitingRoomDraftId(null);
    setLocalInviteStatuses([]);
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

  async function assignFriendToSlot(index: number, friend: Friend | null) {
    const previousFriendId = invitedSlots[index]?.user_id;
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

    if (!friend) {
      if (previousFriendId) {
        setLocalInviteStatuses((current) =>
          current?.filter((status) => status.userId !== previousFriendId) ?? [],
        );
      }
      return;
    }

    setLocalInviteStatuses((current) => [
      ...(current?.filter((status) => status.userId !== friend.user_id) ?? []),
      { userId: friend.user_id, status: "pending" },
    ]);

    if (mode !== "leader") return;

    try {
      const result = await sendMatchingInvite({
        draftId: currentInviteDraftId,
        receiverId: friend.user_id,
        dungeonId,
        characterId,
        stage,
        minCombatPower: combatPowerFromK(minCombatPowerK),
        maxMembers,
        requiredClasses: requiredClasses.filter(Boolean),
      });
      setLocalInviteStatuses((current) => [
        ...(current?.filter((status) => status.userId !== friend.user_id) ?? []),
        result.inviteStatus,
      ]);
      toast.success(
        result.inviteStatus.status === "accepted"
          ? `${friend.nickname}님은 준비 완료되었습니다.`
          : `${friend.nickname}님에게 파티 초대를 보냈습니다.`,
      );
    } catch (error) {
      setLocalInviteStatuses((current) =>
        current?.filter((status) => status.userId !== friend.user_id) ?? [],
      );
      toast.error(error instanceof Error ? error.message : "파티 초대에 실패했습니다.");
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
    if (isGuest) {
      router.push(`/login?next=${encodeURIComponent("/party")}`);
      return;
    }
    if (!dungeonId || pending) return;
    if (mode === "leader" && !isMatchingWaitingRoom) {
      setMatchingWaitingRoomDraftId(currentInviteDraftId);
      router.push(`/party?matchingDraft=${encodeURIComponent(currentInviteDraftId)}`);
      toast.success("매칭 대기룸을 만들었습니다. 여기서 친구를 초대할 수 있습니다.");
      return;
    }
    setPending(true);
    try {
      requestNotificationPermission();
      const invitedFriendIds = invitedSlots
        .map((friend) => friend?.user_id)
        .filter((id): id is string => !!id);
      if (mode === "leader" && hasUnreadyInvitedFriends) {
        toast.error("초대 친구가 모두 준비 완료된 뒤 매칭을 시작할 수 있습니다.");
        return;
      }
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
        draftId: currentInviteDraftId,
        canAutoLead: mode === "member" && canAutoLead,
        autoLeadAfterSeconds,
        allowConditionRelaxation,
      });

      window.dispatchEvent(
        new CustomEvent("arring:matching-status", { detail: result }),
      );

      if (result.matched && result.roomCode) {
        toast.success("파티가 매칭됐습니다. 방으로 이동합니다.");
        router.push(`/room/${result.roomCode}`);
        return;
      }

      if (result.temporaryMatch) {
        toast.success("매칭 후보가 잡혔습니다. 30초 안에 수락해주세요.");
        return;
      }

      if (mode === "leader") {
        toast.success(
          `매칭 요청을 열었습니다. 현재 조건 충족 대기 ${result.waitingCount ?? 0}/${result.needed ?? maxMembers - 1}명`,
        );
      } else {
        toast.success("대기열에 등록했습니다. 조건이 맞는 파티가 생기면 자동으로 연결됩니다.");
      }
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
              <RadioTower className="size-5 text-primary" />
              아이온2 자동매칭
            </CardTitle>
            <CardDescription>
              파티장은 조건을 정하고, 파티원은 진도만 선택하면 점수와 조건을 기준으로 자동 배치됩니다.
            </CardDescription>
          </div>
          {profile && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">매너 {profile.mannerTemperature?.toFixed(1) ?? "50.0"}점</Badge>
              <Badge variant="outline">신뢰 {profile.trustTemperature?.toFixed(1) ?? "50.0"}점</Badge>
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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
            <span>투력을 속일 수 없도록 공식 홈페이지 캐릭터 연동이 먼저 필요합니다.</span>
            <LinkButton href="/profile" variant="outline">캐릭터 연동</LinkButton>
          </div>
        )}

        {isMatchingWaitingRoom && (
          <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-3 text-sm">
            <div className="font-medium">매칭 대기룸</div>
            <p className="mt-1 text-muted-foreground">
              {mode === "leader"
                ? "친구를 초대하고 준비 완료 상태를 확인한 뒤 매칭을 시작하세요."
                : "초대한 파티장이 매칭을 시작할 때까지 이 화면에서 기다려주세요."}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode("member")}
            aria-pressed={mode === "member"}
            className={`rounded-md border px-3 py-3 text-left transition-colors ${
              mode === "member" ? "border-primary bg-primary/10" : "hover:bg-muted/50"
            }`}
          >
            <HeadsetLabel icon={<Users className="size-4" />} title="매칭" body="내 진도를 기준으로 자동 대기" />
          </button>
          <button
            type="button"
            onClick={() => setMode("leader")}
            aria-pressed={mode === "leader"}
            className={`rounded-md border px-3 py-3 text-left transition-colors sm:col-span-2 ${
              mode === "leader" ? "border-primary bg-primary/10" : "hover:bg-muted/50"
            }`}
          >
            <HeadsetLabel icon={<ShieldCheck className="size-4" />} title="매칭 생성" body="대기룸 생성, 친구 초대와 조건 설정" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
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

          <div className="flex flex-col gap-2">
            <Label>콘텐츠</Label>
            <button
              type="button"
              onClick={() => setContentPickerOpen((open) => !open)}
              className="flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50"
              aria-expanded={contentPickerOpen}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {selectedDungeon
                    ? `[${selectedDungeon.category}] ${selectedDungeon.name}`
                    : "콘텐츠를 선택해주세요"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {selectedDungeon
                    ? `★ x ${selectedDungeon.tier ?? 1} · ${partySizeForDungeon(selectedDungeon)}명 고정 · 기믹 ${selectedDungeon.gimmick_stages.length}단계`
                    : "원정, 초월, 성역을 카드로 골라요"}
                </span>
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  contentPickerOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {contentPickerOpen && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex flex-wrap gap-2">
                  {contentCategories.map((category) => {
                    const count = dungeons.filter(
                      (dungeon) => dungeon.category === category,
                    ).length;
                    if (count === 0) return null;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setContentCategory(category)}
                        aria-pressed={contentCategory === category}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          contentCategory === category
                            ? "border-primary bg-primary/15 text-primary"
                            : "bg-background/40 hover:bg-muted"
                        }`}
                      >
                        {category}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-4">
                  {categoryDungeonGroups.map((group) => (
                    <section key={group.tier} aria-labelledby={`dungeon-tier-${group.tier}`}>
                      <div className="mb-2 flex items-center gap-2">
                        <h3
                          id={`dungeon-tier-${group.tier}`}
                          className="text-sm font-semibold text-amber-300"
                        >
                          ★ x {group.tier}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {group.dungeons.length}개
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.dungeons.map((dungeon) => {
                          const selected = dungeon.id === dungeonId;
                          const savedProgress =
                            progress.find((item) => item.dungeonId === dungeon.id)
                              ?.stage ?? 0;
                          return (
                            <button
                              key={dungeon.id}
                              type="button"
                              onClick={() => changeDungeon(dungeon.id)}
                              aria-pressed={selected}
                              className={`min-h-24 rounded-md border p-3 text-left transition-colors ${
                                selected
                                  ? "border-primary bg-primary/15"
                                  : "bg-background/50 hover:bg-muted/60"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-sm font-semibold">
                                  {dungeon.name}
                                </span>
                                <Badge variant={selected ? "default" : "outline"}>
                                  {partySizeForDungeon(dungeon)}명
                                </Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
                                <span>기믹 {dungeon.gimmick_stages.length}단계</span>
                                <span>·</span>
                                <span>
                                  내 진도 {stageLabel(dungeon, savedProgress)}
                                </span>
                              </div>
                              {dungeon.gimmick_stages.length > 0 && (
                                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                  {dungeon.gimmick_stages.join(" / ")}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
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
                  inviteStatuses={localInviteStatuses}
                  inviteStarted={slottedFriendIds.length > 0}
                  friends={friends}
                  minCombatPower={combatPowerFromK(minCombatPowerK)}
                  onChange={changeClassSlot}
                  onAssignFriend={assignFriendToSlot}
                  onMoveFriend={moveFriendSlot}
                />
              </div>
            </>
          )}

          {mode === "member" && (
            <div className="flex flex-col gap-3 rounded-md border px-3 py-3">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={canAutoLead}
                  onChange={(event) => setCanAutoLead(event.target.checked)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="flex flex-col gap-1">
                  <span className="font-medium">파티장 가능</span>
                  <span className="text-xs text-muted-foreground">
                    먼저 파티원으로 매칭을 시도하고, 일정 시간 동안 매칭되지 않으면 설정한 조건으로 파티장이 되어 매칭을 진행합니다.
                  </span>
                </span>
              </label>

              {canAutoLead && (
                <div className="grid gap-3 border-t pt-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="auto-lead-power">최소 투력 (k)</Label>
                      <div className="relative">
                        <Input
                          id="auto-lead-power"
                          type="number"
                          min={0}
                          step={50}
                          max={combatPowerToK(selectedCharacter?.combatPower)}
                          value={minCombatPowerK}
                          onChange={(event) =>
                            setMinCombatPowerK(
                              Math.min(
                                combatPowerToK(selectedCharacter?.combatPower),
                                Math.max(0, Number(event.target.value)),
                              ),
                            )
                          }
                          className="pr-10"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          k
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="auto-lead-delay">파티장 전환 대기</Label>
                      <select
                        id="auto-lead-delay"
                        value={autoLeadAfterSeconds}
                        onChange={(event) => setAutoLeadAfterSeconds(Number(event.target.value))}
                        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value={60} className="bg-popover">60초</option>
                        <option value={90} className="bg-popover">90초</option>
                        <option value={120} className="bg-popover">120초</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={allowConditionRelaxation}
                        onChange={(event) => setAllowConditionRelaxation(event.target.checked)}
                        className="size-4 accent-primary"
                      />
                      조건 완화 허용
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>파티장 전환 시 받을 클래스</Label>
                    <ClassSlotBoard
                      dungeon={selectedDungeon}
                      leaderClass={selectedCharacter?.className}
                      slots={requiredClasses}
                      invitedSlots={createInviteSlots(requiredClasses.length)}
                      inviteStatuses={[]}
                      friends={[]}
                      minCombatPower={combatPowerFromK(minCombatPowerK)}
                      onChange={changeClassSlot}
                      onAssignFriend={() => undefined}
                      onMoveFriend={() => undefined}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            <span>
              선택 진도: {stageLabel(selectedDungeon, stage)}
              {selectedCharacter?.className && ` · ${selectedCharacter.name} ${selectedCharacter.className}`}
              {selectedCharacter?.combatPower && ` · 투력 ${formatCombatPower(selectedCharacter.combatPower)}`}
              {mode === "leader" && ` · 최소 ${minCombatPowerK.toLocaleString()}k · ${maxMembers}명 고정`}
            </span>
            {isGuest ? (
              <LinkButton href="/login?next=%2Fparty">
                로그인 후 매칭 시작
              </LinkButton>
            ) : (
              <Button
                type="submit"
                disabled={
                  pending ||
                  !hasLinkedCharacter ||
                  !characterId ||
                  dungeons.length === 0 ||
                  (mode === "leader" && isMatchingWaitingRoom && hasUnreadyInvitedFriends)
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {mode === "leader"
                  ? isMatchingWaitingRoom
                    ? "매칭 시작"
                    : "매칭 생성"
                  : "매칭"}
              </Button>
            )}
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
  invitedSlots,
  inviteStatuses,
  inviteStarted,
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
  inviteStatuses?: {
    userId: string;
    status: "pending" | "accepted" | "declined" | "cancelled";
  }[];
  inviteStarted?: boolean;
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
  const inviteStatusByUser = new Map(
    (inviteStatuses ?? []).map((invite) => [invite.userId, invite.status]),
  );
  const availableFriends = friends.filter(
    (friend) => friend.is_online && !assignedIds.has(friend.user_id),
  );
  const hasOpenSlot = invitedSlots.some((friend) => !friend);

  function assignToFirstOpenSlot(friend: Friend) {
    const index = invitedSlots.findIndex((slot) => !slot);
    if (index >= 0) onAssignFriend(index, friend);
  }

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
                disabled={!hasOpenSlot}
                onClick={() => assignToFirstOpenSlot(friend)}
                onDragStart={(event) => {
                  event.dataTransfer.setData("friend-id", friend.user_id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                  hasOpenSlot
                    ? "hover:bg-muted/50"
                    : "cursor-not-allowed opacity-50"
                }`}
                title="클릭하거나 슬롯으로 드래그해서 초대"
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
        inviteStatusByUser={inviteStatusByUser}
        inviteStarted={inviteStarted}
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
          inviteStatusByUser={inviteStatusByUser}
          inviteStarted={inviteStarted}
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
  inviteStatusByUser,
  inviteStarted,
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
  inviteStatusByUser: Map<string, "pending" | "accepted" | "declined" | "cancelled">;
  inviteStarted?: boolean;
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
          <Swords className="size-4 text-primary" />
          {title}
        </span>
        <Badge variant="secondary">{leaderClass ? slots.length + 1 : slots.length}명</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        {leaderClass && (
          <div className="flex h-9 items-center rounded-md border border-primary/40 bg-primary/10 px-3 text-sm">
            방장 · {leaderClass}
          </div>
        )}
        {slots.map((className, index) => {
          const globalIndex = offset + index;
          const invitedFriend = invitedSlots[index];
          const inviteStatus = invitedFriend
            ? inviteStatusByUser.get(invitedFriend.user_id)
            : undefined;
          const visibleInviteStatus = invitedFriend
            ? inviteStatus ?? (inviteStarted ? "pending" : "ready")
            : undefined;
          const isWaitingInvite = visibleInviteStatus === "pending";
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
                invitedFriend
                  ? isWaitingInvite
                    ? "bg-muted/15 opacity-60"
                    : "bg-muted/25"
                  : "border-dashed"
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
                  {visibleInviteStatus && (
                    <span
                      className={`text-[11px] ${
                        visibleInviteStatus === "accepted" ? "text-green-400" : "text-primary"
                      }`}
                    >
                      {visibleInviteStatus === "ready"
                        ? "초대 예정"
                        : visibleInviteStatus === "pending"
                          ? "초대중"
                          : visibleInviteStatus === "accepted"
                            ? "준비 완료"
                            : visibleInviteStatus === "declined"
                              ? "거절"
                              : "취소됨"}
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

