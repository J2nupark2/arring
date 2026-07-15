function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function getAion2ProfileImage(detailData: unknown): string | null {
  const profile = asRecord(asRecord(detailData)?.profile);
  if (!profile) return null;

  for (const key of ["profileImage", "profileImageUrl", "image", "imageUrl"]) {
    const value = profile[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const url = value.trim();
    if (url.startsWith("//")) return `https:${url}`;
    if (/^https?:\/\//i.test(url)) return url;
  }

  return null;
}
