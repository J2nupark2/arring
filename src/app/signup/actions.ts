"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { translateAuthError } from "@/lib/auth-errors";
import { enforceActionRateLimit } from "@/lib/rate-limit";

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://a2rring.com";
}

function getEmailRedirectTo() {
  return `${getSiteUrl()}/auth/callback?next=/party`;
}

function getResendFrom() {
  if (process.env.RESEND_FROM_EMAIL) return process.env.RESEND_FROM_EMAIL;
  if (process.env.RESEND_EMAIL_DOMAIN) {
    return `Arring <noreply@${process.env.RESEND_EMAIL_DOMAIN}>`;
  }
  return "Arring <noreply@a2rring.com>";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendSignupEmail(email: string, actionLink: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY가 설정되어 있지 않습니다.");
  }

  const safeEmail = escapeHtml(email);
  const safeActionLink = escapeHtml(actionLink);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: email,
      subject: "Arring 이메일 인증",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
          <h1 style="font-size:20px;margin:0 0 16px">Arring 이메일 인증</h1>
          <p>${safeEmail} 계정으로 Arring 가입을 완료하려면 아래 버튼을 눌러주세요.</p>
          <p style="margin:24px 0">
            <a href="${safeActionLink}" style="display:inline-block;border-radius:8px;background:#8b5cf6;color:white;padding:12px 18px;text-decoration:none;font-weight:700">
              이메일 인증하기
            </a>
          </p>
          <p style="font-size:13px;color:#6b7280">버튼이 열리지 않으면 아래 링크를 브라우저에 붙여넣어주세요.</p>
          <p style="font-size:13px;word-break:break-all;color:#6b7280">${safeActionLink}</p>
        </div>
      `,
      text: `Arring 가입을 완료하려면 아래 링크를 열어주세요.\n\n${actionLink}`,
    }),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const message =
      typeof result?.message === "string"
        ? result.message
        : "Resend 인증 메일 발송에 실패했습니다.";
    throw new Error(message);
  }
}

export async function signup(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const emailConfirmation = (formData.get("emailConfirmation") as string)?.trim();
  const password = formData.get("password") as string;
  const evaluationConsent = formData.get("evaluationConsent");

  if (!email || !password) {
    redirect("/signup?error=" + encodeURIComponent("이메일과 비밀번호를 입력해주세요."));
  }
  if (email !== emailConfirmation) {
    redirect("/signup?error=" + encodeURIComponent("이메일과 이메일 확인이 일치하지 않습니다."));
  }
  if (password.length < 8) {
    redirect("/signup?error=" + encodeURIComponent("비밀번호는 8자 이상이어야 합니다."));
  }
  if (evaluationConsent !== "accepted") {
    redirect(
      "/signup?error=" +
        encodeURIComponent("매칭 후 평가 정보가 다른 이용자에게 표시될 수 있음에 동의해주세요."),
    );
  }

  const rateLimitError = await enforceActionRateLimit({
    scope: "auth-signup",
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimitError) {
    redirect("/signup?error=" + encodeURIComponent(rateLimitError));
  }

  if (process.env.RESEND_API_KEY) {
    const admin = createAdminClient();
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });

    if (createError) {
      redirect("/signup?error=" + encodeURIComponent(translateAuthError(createError.message)));
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: getEmailRedirectTo(),
      },
    });

    if (error) {
      redirect("/signup?error=" + encodeURIComponent(translateAuthError(error.message)));
    }

    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      redirect("/signup?error=" + encodeURIComponent("인증 링크를 만들지 못했습니다."));
    }

    try {
      await sendSignupEmail(email, actionLink);
    } catch (error) {
      redirect(
        "/signup?error=" +
          encodeURIComponent(error instanceof Error ? error.message : "인증 메일 발송에 실패했습니다."),
      );
    }

    redirect("/signup/check-email?email=" + encodeURIComponent(email));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
    },
  });

  if (error) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/party?welcome=1");
    }

    redirect("/signup?error=" + encodeURIComponent(translateAuthError(error.message)));
  }

  if (data.session) redirect("/party?welcome=1");

  redirect("/signup/check-email?email=" + encodeURIComponent(email));
}

export async function resendSignupEmail(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();

  if (!email) {
    redirect("/signup?error=" + encodeURIComponent("인증 메일을 받을 이메일을 다시 입력해주세요."));
  }

  const rateLimitError = await enforceActionRateLimit({
    scope: "auth-signup-resend",
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimitError) {
    redirect(
      `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(rateLimitError)}`,
    );
  }

  const supabase = await createClient();
  if (process.env.RESEND_API_KEY) {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: getEmailRedirectTo(),
      },
    });

    if (error) {
      redirect(
        `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
          translateAuthError(error.message),
        )}`,
      );
    }

    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      redirect(
        `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
          "인증 링크를 만들지 못했습니다.",
        )}`,
      );
    }

    try {
      await sendSignupEmail(email, actionLink);
    } catch (error) {
      redirect(
        `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
          error instanceof Error ? error.message : "인증 메일 발송에 실패했습니다.",
        )}`,
      );
    }

    redirect(`/signup/check-email?email=${encodeURIComponent(email)}&resent=1`);
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
    },
  });

  if (error) {
    redirect(
      `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
        translateAuthError(error.message),
      )}`,
    );
  }

  redirect(`/signup/check-email?email=${encodeURIComponent(email)}&resent=1`);
}
