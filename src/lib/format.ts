export function formatCombatPower(value: number | null | undefined) {
  const power = Math.max(0, Math.trunc(Number(value) || 0));
  if (power < 1000) return power.toLocaleString();
  return `${Math.floor(power / 1000).toLocaleString()}k`;
}
