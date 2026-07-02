// Supabase Auth returns English error messages; map the common ones to
// Korean so users understand why signup/login failed.
const ERROR_TRANSLATIONS: [RegExp, string][] = [
  [/user already registered/i, "이미 가입된 이메일입니다. 로그인해주세요."],
  [
    /password should be at least (\d+) characters/i,
    "비밀번호는 6자 이상이어야 합니다.",
  ],
  [/is invalid/i, "올바르지 않은 이메일 주소입니다."],
  [/invalid login credentials/i, "이메일 또는 비밀번호가 올바르지 않습니다."],
  [/email not confirmed/i, "이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요."],
  [
    /rate limit exceeded/i,
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ],
  [/signups not allowed/i, "현재 회원가입이 비활성화되어 있습니다."],
];

export function translateAuthError(message: string): string {
  for (const [pattern, translation] of ERROR_TRANSLATIONS) {
    if (pattern.test(message)) return translation;
  }
  return `오류가 발생했습니다: ${message}`;
}
