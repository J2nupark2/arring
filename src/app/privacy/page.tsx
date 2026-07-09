import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "Arring 개인정보 처리 항목, 이용 목적, 보관 및 문의 안내입니다.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm font-medium text-violet-300">Arring</Link>
      <h1 className="text-3xl font-bold tracking-tight">개인정보처리방침</h1>
      <p className="text-sm text-muted-foreground">시행일: 2026년 7월 9일</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">수집하는 정보</h2>
        <p className="leading-7 text-muted-foreground">
          Arring은 회원 가입, 로그인, 친구 기능, 파티 매칭, 플레이 기록 제공을 위해
          이메일, 닉네임, 서버, 연동 캐릭터 정보, 매칭 기록, 평가 기록, 접속 상태
          정보를 처리할 수 있습니다.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">이용 목적</h2>
        <p className="leading-7 text-muted-foreground">
          수집된 정보는 계정 식별, 파티 자동매칭, 친구 초대, 플레이 기록 확인,
          비매너 평가 반영, 서비스 보안 및 오류 대응에 사용됩니다.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">보관과 삭제</h2>
        <p className="leading-7 text-muted-foreground">
          서비스 운영에 필요한 정보는 계정 유지 기간 동안 보관됩니다. 계정 삭제나
          정보 정정을 원하면 문의 페이지를 통해 요청할 수 있으며, 법적 보관 의무나
          분쟁 대응에 필요한 경우를 제외하고 합리적인 기간 내 처리합니다.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">광고와 쿠키</h2>
        <p className="leading-7 text-muted-foreground">
          향후 광고가 적용될 경우, 광고 파트너는 맞춤형 광고 제공과 부정 트래픽
          방지를 위해 쿠키 또는 유사 기술을 사용할 수 있습니다. 광고 적용 시 관련
          고지와 선택 옵션을 추가로 안내합니다.
        </p>
      </section>
    </main>
  );
}
