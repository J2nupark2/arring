"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ServerOption = { serverId: number; serverName: string; raceId: number };

type SearchResult = {
  characterId: string;
  name: string;
  level: number;
  serverId: number;
  serverName: string;
};

export function CharacterSearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serverId, setServerId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const elyosServers = servers.filter((server) => server.raceId === 1);
  const asmodianServers = servers.filter((server) => server.raceId !== 1);

  useEffect(() => {
    if (!open || servers.length > 0) return;
    fetch("/api/aion2/servers")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.servers)) return;
        setServers(data.servers);
        setServerId((prev) => prev ?? data.servers[0]?.serverId ?? null);
      })
      .catch(() => toast.error("서버 목록을 불러오지 못했습니다."));
  }, [open, servers.length]);

  async function onSearch(e: React.FormEvent) {
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
      setResults(data.results ?? []);
    } catch {
      toast.error("검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  }

  async function openCharacter(result: SearchResult) {
    setLinking(result.characterId);
    try {
      const res = await fetch("/api/aion2/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: result.characterId,
          serverId: result.serverId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "캐릭터 정보를 불러오지 못했습니다.");
        return;
      }
      setOpen(false);
      setName("");
      setResults(null);
      router.push(`/profile/characters/${data.character.id}`);
      router.refresh();
    } catch {
      toast.error("캐릭터 정보를 불러오지 못했습니다.");
    } finally {
      setLinking(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Search className="size-3.5" />
          <span className="hidden sm:inline">캐릭터 검색</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>캐릭터 검색</DialogTitle>
          <DialogDescription>
            공식 정보실에서 캐릭터를 찾고 아링 상세 페이지로 바로 열어요.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSearch} className="grid gap-3 sm:grid-cols-[150px_1fr_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="header-aion2-server">서버</Label>
            <select
              id="header-aion2-server"
              value={serverId ?? ""}
              onChange={(e) => setServerId(Number(e.target.value))}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              style={{ colorScheme: "dark" }}
            >
              <optgroup
                label="천족"
                className="bg-popover text-popover-foreground"
                style={{ backgroundColor: "#09090b", color: "#fafafa" }}
              >
                {elyosServers.map((server) => (
                  <option
                    key={server.serverId}
                    value={server.serverId}
                    className="bg-popover text-popover-foreground"
                    style={{ backgroundColor: "#09090b", color: "#fafafa" }}
                  >
                    {server.serverName}
                  </option>
                ))}
              </optgroup>
              <optgroup
                label="마족"
                className="bg-popover text-popover-foreground"
                style={{ backgroundColor: "#09090b", color: "#fafafa" }}
              >
                {asmodianServers.map((server) => (
                  <option
                    key={server.serverId}
                    value={server.serverId}
                    className="bg-popover text-popover-foreground"
                    style={{ backgroundColor: "#09090b", color: "#fafafa" }}
                  >
                    {server.serverName}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="header-aion2-name">캐릭터명</Label>
            <Input
              id="header-aion2-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="정확한 캐릭터명"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={searching || !serverId || !name.trim()}>
              {searching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              검색
            </Button>
          </div>
        </form>

        {results !== null && (
          <div className="grid gap-2">
            {results.length === 0 ? (
              <p className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                검색 결과가 없습니다.
              </p>
            ) : (
              results.map((result) => (
                <div
                  key={`${result.serverId}-${result.characterId}`}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{result.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Lv.{result.level} · {result.serverName}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openCharacter(result)}
                    disabled={linking !== null}
                  >
                    {linking === result.characterId && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    열기
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
