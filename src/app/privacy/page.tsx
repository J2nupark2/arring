import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "Arring 개인정보 처리 항목, 목적, 보유기간, 위탁 및 권리 행사 안내입니다.",
  alternates: { canonical: "/privacy" },
};

const sections = [
  {
    title: "1. 처리 목적과 항목",
    body: "Arring은 계정 생성과 인증을 위해 이메일·사용자 식별자를, 캐릭터 연동과 공개 상세 제공을 위해 캐릭터명·서버·직업·전투력·장비·스킬 등 게임 내 공개 정보를 처리합니다. 친구·매칭·통화방 기능을 위해 친구 관계, 접속 상태, 매칭 조건과 결과, 채팅, 참여 기록, 평가·신고 기록을 처리합니다. 서비스 보안과 오류 대응 과정에서 IP 주소, 브라우저 정보, 요청 시각과 오류 로그가 자동으로 생성될 수 있습니다.",
  },
  {
    title: "2. 보유 기간",
    body: "계정, 프로필, 친구 관계와 계정에 연결된 이용 기록은 회원 탈퇴 시까지 보관합니다. 평가와 신고 기록은 점수의 무결성 및 분쟁 대응을 위해 계정 유지 기간 동안 보관할 수 있습니다. 관계 법령에 별도 보존 의무가 있거나 분쟁 처리가 진행 중인 정보는 해당 목적이 끝날 때까지 분리 보관합니다. 공식 정보실에서 수집한 공개 캐릭터 캐시는 연동 해제 후에도 검색 결과 제공을 위해 남을 수 있으며, 삭제 요청이 접수되면 권리와 운영 필요성을 확인해 처리합니다.",
  },
  {
    title: "3. 제3자 제공",
    body: "Arring은 이용자의 개인정보를 판매하지 않으며, 원칙적으로 동의 없이 제3자에게 제공하지 않습니다. 다만 법령에 근거한 요청이 있거나 생명·신체의 급박한 보호가 필요한 경우에는 관련 법령이 허용하는 범위에서 제공할 수 있습니다.",
  },
  {
    title: "4. 처리 위탁과 국외 처리",
    body: "서비스 운영을 위해 Supabase Inc.에 데이터베이스·인증·실시간 기능을, Vercel Inc.에 웹 호스팅·전송·접속 로그·분석을, Resend Inc.에 가입 인증과 비밀번호 재설정 이메일 발송을 위탁합니다. 이 과정에서 이메일, 계정 식별자, 서비스 이용 정보와 기술 로그가 암호화된 네트워크를 통해 미국 등 각 사업자의 인프라 소재 국가에서 지속적으로 처리될 수 있으며, 각 정보는 위 목적 달성 또는 계정 삭제 시까지 사업자의 계약과 보존 정책에 따라 보관됩니다. 국외 처리를 원하지 않는 경우 서비스 이용을 중단하고 계정 삭제를 요청할 수 있으나 계정 기능 이용이 제한됩니다.",
  },
  {
    title: "5. 파기 절차와 방법",
    body: "보유 목적이 끝난 개인정보는 복구하기 어려운 방식으로 삭제합니다. 전자 파일은 데이터베이스와 운영 시스템에서 삭제하고, 백업에 남은 정보는 정해진 백업 순환 주기에 따라 삭제되며 복구 목적 외에는 이용하지 않습니다.",
  },
  {
    title: "6. 이용자의 권리",
    body: "이용자는 프로필에서 자신의 정보를 확인·수정하고 계정을 삭제할 수 있습니다. 열람, 정정, 삭제, 처리정지 또는 평가·신고 기록 관련 이의 제기는 문의 이메일로 요청할 수 있습니다. 본인 확인이 필요한 경우 계정 이메일 등 최소한의 정보를 요청할 수 있으며, 법령상 제한 사유가 있으면 그 이유를 안내합니다.",
  },
  {
    title: "7. 쿠키와 분석",
    body: "로그인 상태 유지와 보안을 위해 필수 쿠키를 사용합니다. Vercel Analytics와 Speed Insights를 통해 페이지 이용 및 성능 정보를 처리할 수 있습니다. 현재 맞춤형 광고 쿠키는 사용하지 않으며, 광고 도입 시 필요한 고지와 동의 선택을 별도로 제공합니다.",
  },
  {
    title: "8. 안전성 확보 조치",
    body: "전송 구간 암호화, 행 단위 접근 통제, 관리자 권한 분리, 요청 횟수 제한, 이메일 인증, 오류 로그 점검과 정기적인 의존성 검사를 적용합니다. 비밀번호 원문은 Arring 서버가 저장하지 않고 인증 제공자가 안전한 방식으로 처리합니다.",
  },
  {
    title: "9. 아동의 개인정보",
    body: "Arring은 만 14세 미만 아동을 대상으로 하지 않습니다. 만 14세 미만 사용자의 정보가 법정대리인 동의 없이 수집된 사실을 알게 되면 확인 후 삭제합니다.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <Link href="/" className="arring-wordmark text-sm">Arring</Link>
      <h1 className="text-3xl font-bold tracking-tight">개인정보처리방침</h1>
      <p className="text-sm text-muted-foreground">시행일: 2026년 7월 15일</p>
      {sections.map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p className="leading-7 text-muted-foreground">{section.body}</p>
        </section>
      ))}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">10. 개인정보 보호책임자와 구제 방법</h2>
        <p className="leading-7 text-muted-foreground">
          개인정보 보호책임자는 Arring 운영자이며, 문의는{" "}
          <a className="underline" href="mailto:wlsdn1323@naver.com">wlsdn1323@naver.com</a>으로
          접수합니다. 개인정보 침해 상담은 개인정보침해 신고센터(국번 없이 118) 또는
          개인정보분쟁조정위원회(1833-6972)를 이용할 수 있습니다.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">11. 방침 변경</h2>
        <p className="leading-7 text-muted-foreground">
          내용이 변경되면 시행일 전에 서비스 화면을 통해 알립니다. 이용자 권리에 중요한
          변경은 합리적인 기간을 두고 별도로 안내합니다.
        </p>
      </section>
    </main>
  );
}
