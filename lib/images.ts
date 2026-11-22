import type { SupabaseClient } from "@supabase/supabase-js";

export const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif", "image/avif": "avif",
};
export const imageAccept = Object.keys(imageExtensions).join(",");

export function validatePhoto(file: File) {
  if (!imageExtensions[file.type] || file.size > 15728640 || file.size === 0) {
    throw new Error("Choose JPEG, PNG, WebP, HEIC, HEIF, or AVIF images up to 15 MB each.");
  }
}

export async function uploadPhoto(client: SupabaseClient, folder: string, file: File, id: string) {
  validatePhoto(file);
  const path = `${folder}/${id}.${imageExtensions[file.type]}`;
  const result = await client.storage.from("baking-photos").upload(path, file, { contentType: file.type, upsert: false });
  if (result.error) throw new Error(result.error.message);
  return path;
}
