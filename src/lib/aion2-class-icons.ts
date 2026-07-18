const AION2_CHARACTER_ASSET_BASE =
  "https://assets.playnccdn.com/static-aion2/characters/img/daevanion";

export const AION2_CLASS_ICON_URLS: Record<string, string> = {
  검성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_gladiator.png`,
  수호성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_templar.png`,
  살성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_assassin.png`,
  궁성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_ranger.png`,
  마도성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_sorcerer.png`,
  정령성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_elementalist.png`,
  치유성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_cleric.png`,
  호법성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_chanter.png`,
  권성: `${AION2_CHARACTER_ASSET_BASE}/board_icon_start_fighter.png`,
};

export function getAion2ClassIconUrl(className: string | null | undefined) {
  if (!className) return null;
  return AION2_CLASS_ICON_URLS[className.trim()] ?? null;
}
