import { redirect } from "next/navigation";

// /party is the default post-auth screen now; keep this route alive for
// old links/bookmarks and just forward along.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [
      string,
      string,
    ][],
  ).toString();
  redirect(qs ? `/party?${qs}` : "/party");
}
