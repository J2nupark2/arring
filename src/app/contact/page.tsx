import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { SupportInquiries } from "@/components/contact/support-inquiries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "문의",
  description: "Arring 서비스 문의, 오류 제보, 개인정보 요청 안내입니다.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user && !user.is_anonymous);

  return (
    <>
      <AppHeader isGuest={!signedIn} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">문의</h1>
          <p className="mt-2 leading-7 text-muted-foreground">
            오류 제보, 계정 및 개인정보 요청, 광고·제휴 문의를 접수할 수 있습니다.
            관리자가 확인한 뒤 이 페이지에서 답변합니다.
          </p>
        </div>
        <SupportInquiries signedIn={signedIn} />
        <section className="space-y-2 border-t pt-6 text-sm text-muted-foreground">
          <h2 className="font-semibold text-foreground">이메일 문의</h2>
          <p>
            로그인이 어렵거나 긴급한 개인정보 요청은{" "}
            <a
              className="font-medium text-foreground underline underline-offset-4"
              href="mailto:wlsdn1323@naver.com"
            >
              wlsdn1323@naver.com
            </a>
            으로 보내주세요.
          </p>
        </section>
      </main>
    </>
  );
}
