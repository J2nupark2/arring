import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "문의",
  description: "Arring 서비스 문의, 오류 제보, 개인정보 요청 안내입니다.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm font-medium text-violet-300">Arring</Link>
      <h1 className="text-3xl font-bold tracking-tight">문의</h1>
      <p className="leading-7 text-muted-foreground">
        오류 제보, 계정 및 개인정보 요청, 광고 및 제휴 문의는 아래 이메일로 보내주세요.
        서비스 개선에 필요한 내용은 확인 후 순차적으로 반영합니다.
      </p>
      <div className="rounded-md border p-4">
        <p className="text-sm text-muted-foreground">운영 문의</p>
        <a className="mt-1 block font-medium underline" href="mailto:wlsdn1323@naver.com">
          wlsdn1323@naver.com
        </a>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">문의 시 포함하면 좋은 정보</h2>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          <li>사용 중인 계정 이메일 또는 닉네임</li>
          <li>문제가 발생한 페이지 주소</li>
          <li>오류가 발생한 시간과 상황</li>
          <li>가능하다면 화면 캡처 또는 재현 순서</li>
        </ul>
      </section>
    </main>
  );
}
