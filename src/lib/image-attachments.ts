export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export type ImageUploadContext =
  | { context: "inquiry" }
  | { context: "direct-message"; otherUserId: string }
  | { context: "room"; roomId: string };

export function privateImageUrl(path: string) {
  return `/api/images?path=${encodeURIComponent(path)}`;
}

export async function uploadPrivateImage(
  file: File,
  uploadContext: ImageUploadContext,
) {
  const form = new FormData();
  form.set("file", file);
  form.set("context", uploadContext.context);
  if ("otherUserId" in uploadContext) {
    form.set("otherUserId", uploadContext.otherUserId);
  }
  if ("roomId" in uploadContext) form.set("roomId", uploadContext.roomId);

  const response = await fetch("/api/images", { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    path?: string;
  };
  if (!response.ok || !data.path) {
    throw new Error(data.error ?? "이미지를 업로드하지 못했습니다.");
  }
  return data.path;
}

export async function removePrivateImage(path: string) {
  await fetch(`/api/images?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}
