# Arring

아이온2 파티 자동매칭, 캐릭터 정보, 친구 초대와 음성 통화방을 제공하는 Next.js 서비스입니다.

## Local development

필수 환경 변수는 `.env.local`에 설정합니다. 값 자체는 Git에 커밋하지 않습니다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
```

```bash
npm install
npm run dev
```

로컬 주소는 `http://localhost:3000`이며 상태 점검은 `/api/health`에서 확인합니다.

## Release checks

프로덕션 푸시 전 아래 검사를 모두 통과해야 합니다.

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test:matching
npm run test:matching:http
npm audit --omit=dev --audit-level=high
```

`test:matching:http`는 로컬 개발 서버가 실행 중이어야 합니다. 테스트는 격리된 던전과 계정을 만들고 종료 시 정리합니다.

## Database migrations

마이그레이션은 `supabase/migrations`에 순번대로 추가합니다. 기존 파일은 프로덕션 적용 후 수정하지 않습니다.

```bash
supabase migration list
supabase db push
```

DB 적용 후 매칭 스모크 테스트를 다시 실행합니다. RLS 변경은 브라우저 클라이언트와 서비스 역할 경로를 각각 확인합니다.

무료 플랜에서는 자동 일일 백업이 제공되지 않으므로 정기적으로 아래 수동 백업을 실행합니다.

```bash
npm run backup:production
```

백업은 `.backups`에 생성되고 Git에서 제외됩니다. 서비스가 사용하는 공개 테이블 데이터와
행 수·SHA-256 검증용 manifest를 포함합니다. 테이블 구조는 `supabase/migrations`로 관리합니다.
계정 인증 데이터까지 포함하는 완전 복구와 자동 보존이 필요하면 Supabase Pro 이상의 일일
백업을 사용합니다.

## Deployment

`main` 푸시가 Vercel 프로덕션 배포를 시작합니다.

```bash
git push origin HEAD:main
vercel ls
vercel inspect <deployment-url>
```

배포가 Ready가 되면 아래를 확인합니다.

- `https://a2rring.com/api/health`가 `200`과 `status: ok`를 반환하는지 확인
- 홈, 로그인, 파티 구하기, 캐릭터 상세 페이지 응답 확인
- 테스트 계정으로 매칭 시작, 수락, 방 이동, 채팅, 닉네임 복사 확인
- Vercel Runtime Logs에서 `uncaught_request_error`, `health_check_failed`, `rate_limit_check_failed` 검색

## Incident response

1. `/api/health`와 Vercel 배포 상태를 확인합니다.
2. Runtime Logs에서 오류 이벤트와 최초 발생 시간을 찾습니다.
3. DB 문제면 Supabase 상태, 연결 수, 최근 마이그레이션을 확인합니다.
4. 앱 배포 문제면 직전 Ready 배포를 Vercel에서 Promote해 롤백합니다.
5. 데이터 변경이 포함된 장애는 코드를 먼저 롤백하지 말고 호환성을 확인한 뒤 보정 마이그레이션을 추가합니다.
6. 복구 후 매칭 HTTP E2E와 핵심 페이지 스모크 테스트를 다시 실행합니다.

운영 전 Supabase 백업 보존 기간과 복구 가능 여부를 대시보드에서 확인하고, 운영자 계정에는 MFA를 적용합니다.
