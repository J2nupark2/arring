import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "아링(Arring) — 아이온2 원클릭 통화방",
  description:
    "링크 없이 한 번에 들어가는 아이온2 던전 파티 통화방. 마음에 든 파티원은 친구 추가로 계속 함께 플레이하세요.",
  openGraph: {
    title: "아링(Arring) — 아이온2 원클릭 통화방",
    description:
      "링크 없이 한 번에 들어가는 아이온2 던전 파티 통화방. 파티 구하기로 새 파티원도 만나보세요.",
    siteName: "Arring",
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
