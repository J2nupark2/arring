// Aion2 game constants. The class list is fixed by the game itself;
// dungeon/raid content lives in the DB (admin-editable) since it changes
// with game patches.

export const AION2_CLASSES = [
  "검성",
  "수호성",
  "살성",
  "마도성",
  "궁성",
  "정령성",
  "권성",
  "치유성",
  "호법성",
] as const;

export type Aion2Class = (typeof AION2_CLASSES)[number];

export const DUNGEON_CATEGORIES = ["원정", "초월", "성역"] as const;

export type DungeonCategory = (typeof DUNGEON_CATEGORIES)[number];

export type Dungeon = {
  id: string;
  category: DungeonCategory;
  name: string;
  gimmick_stages: string[];
  sort_order: number;
  is_active: boolean;
};
