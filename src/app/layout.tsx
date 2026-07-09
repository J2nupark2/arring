import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GlobalMatchingProvider } from "@/components/global-matching-provider";
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://a2rring.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "아링(Arring) - 아이온2 파티 자동매칭",
  description:
    "아이온2 원정, 초월, 성역 파티를 클래스 조합, 전투력, 기믹 진도, 매너 점수 기준으로 자동 매칭하는 파티 구하기 서비스입니다.",
  openGraph: {
    title: "아링(Arring) - 아이온2 파티 자동매칭",
    description:
      "아이온2 아링에서 파티 구성을 더 빠르고 투명하게 맞춰보세요. 캐릭터 연동, 친구 초대, 자동매칭, 플레이 기록을 지원합니다.",
    siteName: "Arring",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "아링(Arring) - 아이온2 파티 자동매칭",
    description: "아이온2 파티 자동매칭과 플레이어 평가 기반 파티 구하기 서비스입니다.",
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
        <GlobalMatchingProvider />
        <Toaster />
      </body>
    </html>
  );
}
