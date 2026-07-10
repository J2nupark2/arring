"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AION2_CLASSES } from "@/lib/aion2";
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

const CLASS_OPTIONS = ["공통", ...AION2_CLASSES] as const;

const TIER_LABELS: Record<number, string> = {
  1: "1순위 (최우선)",
  2: "2순위",
  3: "3순위",
  4: "4순위 (낮음)",
};

type PriorityRow = {
  id: string;
  class_name: string;
  stat_key: string;
  stat_label: string;
  tier: number;
};

const EMPTY_FORM = { statKey: "", statLabel: "", tier: 1 };

export function StatPriorityManager() {
  const [rows, setRows] = useState<PriorityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState<string>(CLASS_OPTIONS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("class_stat_priority")
      .select("*")
      .order("class_name")
      .order("tier")
      .order("stat_label");
    if (error) {
      toast.error("우선순위 목록을 불러오지 못했습니다: " + error.message);
      return;
    }
    setRows((data ?? []) as PriorityRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId("new");
  }

  function startEdit(row: PriorityRow) {
    setForm({ statKey: row.stat_key, statLabel: row.stat_label, tier: row.tier });
    setEditingId(row.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const statKey = form.statKey.trim();
    const statLabel = form.statLabel.trim();
    if (!statKey || !statLabel) return;

    setSaving(true);
    const supabase = createClient();
    const row = {
      class_name: classFilter,
      stat_key: statKey,
      stat_label: statLabel,
      tier: form.tier,
      updated_at: new Date().toISOString(),
    };
    const { error } =
      editingId === "new"
        ? await supabase.from("class_stat_priority").upsert(row, {
            onConflict: "class_name,stat_key",
          })
        : await supabase
            .from("class_stat_priority")
            .update(row)
            .eq("id", editingId!);
    setSaving(false);

    if (error) {
      toast.error("저장에 실패했습니다: " + error.message);
      return;
    }
    toast.success("저장했습니다");
    setEditingId(null);
    refresh();
  }

  async function remove(row: PriorityRow) {
    if (!window.confirm(`'${row.stat_label}' 우선순위를 삭제할까요?`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("class_stat_priority")
      .delete()
      .eq("id", row.id);
    if (error) {
      toast.error("삭제에 실패했습니다: " + error.message);
      return;
    }
    toast.success("삭제했습니다");
    refresh();
  }

  const visibleRows = rows.filter((row) => row.class_name === classFilter);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">영혼각인 · 마석 옵션 우선순위</CardTitle>
          <CardDescription>
            아이온2는 딜 계산 공식을 공개하지 않아서 정밀 효율 계산은 불가능해요.
            대신 클래스별로 &ldquo;이 옵션이 더 좋다&rdquo;는 우선순위를 직접 입력하면
            캐릭터 상세 페이지의 각인 옵션 옆에 등급으로 표시됩니다. 커뮤니티
            공략 기준으로 클래스마다 다르게 채워주세요 (공통 값은 딜러 기준
            일반값이라 수호성·치유성 같은 역할군엔 안 맞을 수 있어요).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stat-priority-class">클래스</Label>
            <select
              id="stat-priority-class"
              value={classFilter}
              onChange={(e) => {
                setClassFilter(e.target.value);
                setEditingId(null);
              }}
              className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c} className="bg-popover">
                  {c}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {editingId === null ? (
        <Button onClick={startCreate} className="self-start">
          <Plus className="size-4" />
          {classFilter} 우선순위 추가
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {editingId === "new" ? `${classFilter} 우선순위 추가` : "우선순위 수정"}
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
                <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                  <Label htmlFor="stat-key">스탯 키 (공식 API 원문)</Label>
                  <Input
                    id="stat-key"
                    value={form.statKey}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, statKey: e.target.value }))
                    }
                    placeholder="예: WeaponFixingDamage"
                    required
                  />
                </div>
                <div className="flex min-w-32 flex-1 flex-col gap-1.5">
                  <Label htmlFor="stat-label">표시 이름</Label>
                  <Input
                    id="stat-label"
                    value={form.statLabel}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, statLabel: e.target.value }))
                    }
                    placeholder="예: 공격력"
                    required
                  />
                </div>
                <div className="flex w-40 flex-col gap-1.5">
                  <Label htmlFor="stat-tier">우선순위</Label>
                  <select
                    id="stat-tier"
                    value={form.tier}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, tier: Number(e.target.value) }))
                    }
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {[1, 2, 3, 4].map((tier) => (
                      <option key={tier} value={tier} className="bg-popover">
                        {TIER_LABELS[tier]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={saving} className="self-start">
                {saving ? "저장 중..." : "저장"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}

      {!loading && visibleRows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {classFilter}에 등록된 우선순위가 없습니다
            </CardTitle>
            <CardDescription>
              위의 &lsquo;추가&rsquo;로 이 클래스의 옵션 우선순위를 등록하세요.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      {visibleRows.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleRows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="outline">{TIER_LABELS[row.tier]}</Badge>
                  <span className="font-medium">{row.stat_label}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.stat_key}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${row.stat_label} 수정`}
                    onClick={() => startEdit(row)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${row.stat_label} 삭제`}
                    onClick={() => remove(row)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
