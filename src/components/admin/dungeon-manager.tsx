"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DUNGEON_CATEGORIES, type Dungeon, type DungeonCategory } from "@/lib/aion2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const EMPTY_FORM = {
  category: "원정" as DungeonCategory,
  name: "",
  stagesText: "",
  tier: 1,
  sortOrder: 0,
};

function loadDungeons() {
  return createClient()
    .from("dungeons")
    .select("*")
    .order("category")
    .order("tier", { ascending: false })
    .order("sort_order")
    .order("name");
}

export function DungeonManager() {
  const [dungeons, setDungeons] = useState<Dungeon[]>([]);
  const [loading, setLoading] = useState(true);
  // null = not editing; "new" = creating; otherwise the dungeon id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await loadDungeons();
    if (error) {
      toast.error("던전 목록을 불러오지 못했습니다: " + error.message);
      return;
    }
    setDungeons((data ?? []) as Dungeon[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadDungeons().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        toast.error("던전 목록을 불러오지 못했습니다: " + error.message);
      } else {
        setDungeons((data ?? []) as Dungeon[]);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId("new");
  }

  function startEdit(d: Dungeon) {
    setForm({
      category: d.category,
      name: d.name,
      stagesText: d.gimmick_stages.join("\n"),
      tier: d.tier ?? 1,
      sortOrder: d.sort_order,
    });
    setEditingId(d.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const stages = form.stagesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    setSaving(true);
    const supabase = createClient();
    const row = {
      category: form.category,
      name,
      gimmick_stages: stages,
      tier: Math.min(99, Math.max(1, Math.round(form.tier))),
      sort_order: form.sortOrder,
    };
    const { error } =
      editingId === "new"
        ? await supabase.from("dungeons").insert(row)
        : await supabase.from("dungeons").update(row).eq("id", editingId!);
    setSaving(false);

    if (error) {
      toast.error("저장에 실패했습니다: " + error.message);
      return;
    }
    toast.success(editingId === "new" ? "던전을 추가했습니다" : "저장했습니다");
    setEditingId(null);
    refresh();
  }

  async function remove(d: Dungeon) {
    if (!window.confirm(`'${d.name}' 던전을 삭제할까요? 유저들의 진도 기록도 함께 삭제됩니다.`)) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("dungeons").delete().eq("id", d.id);
    if (error) {
      toast.error("삭제에 실패했습니다: " + error.message);
      return;
    }
    toast.success("삭제했습니다");
    refresh();
  }

  async function toggleActive(d: Dungeon) {
    const supabase = createClient();
    const { error } = await supabase
      .from("dungeons")
      .update({ is_active: !d.is_active })
      .eq("id", d.id);
    if (error) {
      toast.error("변경에 실패했습니다: " + error.message);
      return;
    }
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {editingId === null ? (
        <Button onClick={startCreate} className="self-start">
          <Plus className="size-4" />
          던전 추가
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {editingId === "new" ? "던전 추가" : "던전 수정"}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="닫기"
                onClick={() => setEditingId(null)}
              >
                <X className="size-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dungeon-category">분류</Label>
                  <select
                    id="dungeon-category"
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        category: e.target.value as DungeonCategory,
                      }))
                    }
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {DUNGEON_CATEGORIES.map((c) => (
                      <option key={c} value={c} className="bg-popover">
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                  <Label htmlFor="dungeon-name">던전 이름</Label>
                  <Input
                    id="dungeon-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="예: 불의 신전"
                    required
                  />
                </div>
                <div className="flex w-24 flex-col gap-1.5">
                  <Label htmlFor="dungeon-tier">티어</Label>
                  <Input
                    id="dungeon-tier"
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    value={form.tier}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        tier: Number(e.target.value) || 1,
                      }))
                    }
                    required
                  />
                </div>
                <div className="flex w-24 flex-col gap-1.5">
                  <Label htmlFor="dungeon-sort">정렬 순서</Label>
                  <Input
                    id="dungeon-sort"
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sortOrder: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dungeon-stages">기믹 진도 단계 (한 줄에 하나, 순서대로)</Label>
                <textarea
                  id="dungeon-stages"
                  value={form.stagesText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, stagesText: e.target.value }))
                  }
                  rows={5}
                  placeholder={"예:\n1넴 경험\n2넴 경험\n막넴 경험\n클리어"}
                  className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              <Button type="submit" disabled={saving} className="self-start">
                {saving ? "저장 중..." : "저장"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      )}

      {!loading && dungeons.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">등록된 던전이 없습니다</CardTitle>
            <CardDescription>
              위의 &lsquo;던전 추가&rsquo;로 매칭에 사용할 던전을 등록하세요.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      {DUNGEON_CATEGORIES.map((category) => {
        const list = dungeons
          .filter((d) => d.category === category)
          .sort(
            (a, b) =>
              (b.tier ?? 1) - (a.tier ?? 1) ||
              a.sort_order - b.sort_order ||
              a.name.localeCompare(b.name, "ko"),
          );
        if (list.length === 0) return null;
        return (
          <div key={category} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {category}
            </h2>
            {list.map((d) => (
              <Card key={d.id}>
                <CardContent className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="flex items-center gap-2 font-medium">
                      {d.name}
                      <Badge variant="outline">★ x {d.tier ?? 1}</Badge>
                      {!d.is_active && (
                        <Badge variant="secondary">비활성</Badge>
                      )}
                    </span>
                    {d.gimmick_stages.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {d.gimmick_stages.map((stage, i) => (
                          <Badge key={i} variant="outline">
                            {i + 1}. {stage}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        진도 단계 없음
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(d)}
                    >
                      {d.is_active ? "비활성화" : "활성화"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${d.name} 수정`}
                      onClick={() => startEdit(d)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${d.name} 삭제`}
                      onClick={() => remove(d)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        );
      })}
    </div>
  );
}
