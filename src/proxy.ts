import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Session refresh only matters where auth is actually checked — keeping
  // public pages (landing, login, signup) out of the matcher saves a
  // Supabase round trip on every visit.
  matcher: ["/dashboard/:path*", "/room/:path*", "/auth/:path*"],
};
