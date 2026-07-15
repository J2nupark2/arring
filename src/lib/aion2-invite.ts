export function getAion2ServerShortName(server: string | null | undefined) {
  if (!server) return "";
  return Array.from(server.normalize("NFC").replace(/\s+/g, ""))
    .slice(0, 2)
    .join("");
}

export function formatAion2InviteName(
  nickname: string,
  server: string | null | undefined,
) {
  const cleanNickname = nickname.normalize("NFC").replace(/\s+/g, "");
  const shortServer = getAion2ServerShortName(server);
  return shortServer ? `${cleanNickname}[${shortServer}]` : cleanNickname;
}
