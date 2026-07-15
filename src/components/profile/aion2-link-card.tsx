"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw, Search, Star, Swords, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCombatPower } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type LinkedCharacter = {
  id?: string;
  characterId: string;
  characterName: string;
  serverId: number;
  server: string;
  charClass: string;
  level?: number;
  combatPower: number;
  isPrimary?: boolean;
  syncedAt: string | null;
};

type ServerOption = { serverId: number; serverName: string; raceId: number };

type SearchResult = {
  characterId: string;
  name: string;
  level: number;
  serverId: number;
  serverName: string;
};

export function Aion2LinkCard({
  linked,
  characters,
}: {
  linked: LinkedCharacter | null;
  characters: LinkedCharacter[];
}) {
  const router = useRouter();
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serverId, setServerId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [primarying, setPrimarying] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LinkedCharacter | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/aion2/servers")
      .then((r) => r.json())
      .then((data) => {
        if (data.servers) {
          setServers(data.servers);
          setServerId((prev) => prev ?? data.servers[0]?.serverId ?? null);
        }
      })
      .catch(() => toast.error("서버 목록을 불러오지 못했습니다."));
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !serverId) return;
    setSearching(true);
    setResults(null);
    try {
      const res = await fetch(
        `/api/aion2/search?name=${encodeURIComponent(name.trim())}&serverId=${serverId}`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "검색에 실패했습니다.");
        return;
      }
      setResults(data.results);
    } catch {
      toast.error("검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  }

  async function link(characterId: string, targetServerId: number) {
    setLinking(characterId);
    try {
      const res = await fetch("/api/aion2/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, serverId: targetServerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "연동에 실패했습니다.");
        return;
      }
      toast.success(
        `${data.character.name} (${data.character.className}, 투력 ${formatCombatPower(data.character.combatPower)}) 연동 완료!`,
      );
      setResults(null);
      setName("");
      router.refresh();
    } catch {
      toast.error("연동에 실패했습니다.");
    } finally {
      setLinking(null);
    }
  }

  async function resync(character: LinkedCharacter) {
    setSyncing(true);
    try {
      await link(character.characterId, character.serverId);
    } finally {
      setSyncing(false);
    }
  }

  async function setPrimary(id: string) {
    setPrimarying(id);
    try {
      const res = await fetch("/api/aion2/primary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "대표 캐릭터 설정에 실패했습니다.");
        return;
      }
      toast.success("대표 캐릭터를 변경했습니다.");
      router.refresh();
    } catch {
      toast.error("대표 캐릭터 설정에 실패했습니다.");
    } finally {
      setPrimarying(null);
    }
  }

  async function unlinkCharacter() {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/aion2/unlink", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(data.error ?? "캐릭터 연동을 삭제하지 못했습니다.");
        return;
      }
      toast.success(`${deleteTarget.characterName} 캐릭터 연동을 삭제했습니다.`);
      setDeleteTarget(null);
      router.refresh();
    } catch {
      toast.error("캐릭터 연동을 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {characters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Swords className="size-4 text-violet-400" />
              연동된 캐릭터
            </CardTitle>
            <CardDescription>
              파티를 구할 때 사용할 캐릭터를 대표로 지정할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {characters.map((character) => (
              <div
                key={character.id ?? character.characterId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium">
                    {character.characterName}
                    <span className="text-muted-foreground">({character.server})</span>
                    {character.isPrimary && (
                      <Badge variant="secondary">
                        <Star className="size-3 fill-current" />
                        대표
                      </Badge>
                    )}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {character.level !== undefined && (
                      <Badge variant="outline">Lv.{character.level}</Badge>
                    )}
                    <Badge variant="outline">{character.charClass}</Badge>
                    <Badge variant="secondary">
                      투력 {formatCombatPower(character.combatPower)}
                    </Badge>
                  </div>
                  {character.syncedAt && (
                    <span className="text-xs text-muted-foreground">
                      마지막 동기화:{" "}
                      {new Date(character.syncedAt).toLocaleString("ko-KR")}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/profile/characters/${character.id}`}>
                      <ExternalLink className="size-3.5" />
                      상세
                    </Link>
                  </Button>
                  {character.id && !character.isPrimary && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrimary(character.id!)}
                      disabled={primarying !== null}
                    >
                      {primarying === character.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Star className="size-3.5" />
                      )}
                      대표로 사용
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resync(character)}
                    disabled={syncing}
                  >
                    {syncing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    동기화
                  </Button>
                  {character.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(character)}
                      disabled={deleting}
                    >
                      <Trash2 className="size-3.5" />
                      연동 삭제
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{linked ? "캐릭터 추가 연동" : "캐릭터 연동"}</CardTitle>
          <CardDescription>
            서버를 고르고 캐릭터 이름을 검색하세요. 투력과 클래스는 공식
            홈페이지에서 자동으로 가져옵니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={search} className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="aion2-server">서버</Label>
                <select
                  id="aion2-server"
                  value={serverId ?? ""}
                  onChange={(e) => setServerId(Number(e.target.value))}
                  className="h-8 min-w-32 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {servers.map((s) => (
                    <option key={s.serverId} value={s.serverId} className="bg-popover">
                      {s.serverName} ({s.raceId === 1 ? "천족" : "마족"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor="aion2-name">캐릭터 이름</Label>
                <Input
                  id="aion2-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="정확한 캐릭터 이름"
                  required
                />
              </div>
              <div className="flex flex-col justify-end">
                <Button type="submit" disabled={searching || !serverId}>
                  {searching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  검색
                </Button>
              </div>
            </div>
          </form>

          {results !== null && (
            <div className="mt-4 flex flex-col gap-2">
              {results.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  검색 결과가 없습니다. 이름과 서버를 다시 확인해주세요.
                </p>
              )}
              {results.map((r) => (
                <div
                  key={r.characterId}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="text-sm">
                    {r.name}{" "}
                    <span className="text-muted-foreground">
                      Lv.{r.level} · {r.serverName}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    disabled={linking !== null}
                    onClick={() => link(r.characterId, r.serverId)}
                  >
                    {linking === r.characterId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      "이 캐릭터 연동"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>캐릭터 연동을 삭제할까요?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.characterName} 캐릭터를 내 프로필과 매칭 선택 목록에서 제거합니다.
              과거 플레이 기록은 유지되며, 삭제한 캐릭터는 다시 연동할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget?.isPrimary && characters.length > 1 && (
            <p className="text-sm text-muted-foreground">
              대표 캐릭터를 삭제하면 다른 연동 캐릭터가 자동으로 대표 캐릭터가 됩니다.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void unlinkCharacter()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {deleting ? "삭제 중" : "연동 삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
