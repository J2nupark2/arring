import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const digest = "digest" in normalizedError
    ? String((normalizedError as Error & { digest?: string }).digest ?? "")
    : "";
  console.error(JSON.stringify({
    event: "uncaught_request_error",
    message: normalizedError.message,
    digest,
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
    timestamp: new Date().toISOString(),
  }));
};
