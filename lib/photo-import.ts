import { createHash } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { z } from "zod";
import { uuid } from "./domain";

// A photo import is a small JSON manifest plus the image as base64 text, either inline in `image.data`
// or split across `<importId>.part-01.txt`, `<importId>.part-02.txt`, ... next to the manifest.
export const maxImageBytes = 10 * 1024 * 1024;
export const maxPixels = 40_000_000;
export const maxParts = 40;
const key = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const base64 = z.string().regex(/^[A-Za-z0-9+/\s]*={0,2}\s*$/, "Use plain base64 without a data: prefix.");

export const photoInboxSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("photo"),
  importId: uuid,
  recipeKey: key,
  existingRecipeId: uuid.optional(),
  recipeName: z.string().trim().min(1).max(200).optional(),
  // true: this photo becomes the main photo and the old main photo stays in the gallery.
  setAsPrimary: z.boolean().default(false),
  // "replacePrimary": this photo becomes the main photo and the old main photo is removed.
  mode: z.enum(["add", "replacePrimary"]).default("add"),
  caption: z.string().trim().max(300).optional(),
  filename: z.string().trim().max(255).optional(),
  // Optional focus point for the 16:9 card crop, as fractions of the oriented photo. Without it the
  // importer keeps the most detailed region in frame.
  crop: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(4).default(1) }).optional(),
  image: z.strictObject({
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
    sha256: sha,
    data: base64.max(Math.ceil(maxImageBytes / 3) * 4 + 4096).optional(),
    parts: z.number().int().min(1).max(maxParts).optional(),
  }).refine((image) => (image.data === undefined) !== (image.parts === undefined), "Provide either image.data or image.parts."),
});
export type PhotoInbox = z.infer<typeof photoInboxSchema>;

const signatures: [string, (bytes: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  ["image/heic", (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(b.subarray(8, 12).toString("latin1"))],
];
export function sniff(bytes: Buffer) {
  return signatures.find(([, test]) => bytes.length > 12 && test(bytes))?.[0];
}

// Decode, check size, check the hash ChatGPT computed, and check the real file type from its bytes.
export function decodeImage(manifest: PhotoInbox, parts: string[] = []) {
  const text = (manifest.image.data ?? parts.join("")).replace(/\s+/g, "");
  if (!text.length) throw new Error("The image data is empty.");
  if (text.length > Math.ceil(maxImageBytes / 3) * 4) throw new Error("The image is larger than 10 MB.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error("The image data is not valid base64.");
  const bytes = Buffer.from(text, "base64");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== manifest.image.sha256) throw new Error("The image data does not match image.sha256. The transfer was incomplete or altered.");
  const type = sniff(bytes);
  if (!type) throw new Error("The file is not a JPEG, PNG, WebP or HEIC image.");
  return { bytes, hash, type };
}

export type Processed = { full: Buffer; card: Buffer; thumb: Buffer; width: number; height: number; contentType: "image/webp" };

// Server-side processing: apply EXIF orientation, drop metadata, keep proportions, make a 16:9 card
// (1920 x 1080) and a 640 x 360 thumbnail. The photo itself is never retouched.
export async function processImage(bytes: Buffer, crop?: { x: number; y: number; zoom: number }): Promise<Processed> {
  const options = { limitInputPixels: maxPixels, failOn: "error" as const };
  let oriented: { data: Buffer; info: OutputInfo };
  try {
    const meta = await sharp(bytes, options).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > maxPixels) throw new Error("size");
    if ((meta.pages ?? 1) > 1 && meta.format !== "heif") throw new Error("animated");
    oriented = await sharp(bytes, options).rotate().png().toBuffer({ resolveWithObject: true });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "";
    throw new Error(reason === "size" ? "The image is larger than 40 megapixels." : reason === "animated" ? "Animated images are not supported." :
      /heif|heic|compression format/i.test(reason) ? "This HEIC photo can't be decoded here. Send it as JPEG instead." : "The image could not be decoded.");
  }
  const { width, height } = oriented.info;
  const full = await sharp(oriented.data).resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  let card: Buffer;
  if (crop) {
    const scale = Math.max(1920 / width, 1080 / height) * crop.zoom;
    const cw = Math.min(width, Math.round(1920 / scale));
    const ch = Math.min(height, Math.round(1080 / scale));
    const left = Math.round(Math.min(Math.max(crop.x * width - cw / 2, 0), width - cw));
    const top = Math.round(Math.min(Math.max(crop.y * height - ch / 2, 0), height - ch));
    card = await sharp(oriented.data).extract({ left, top, width: cw, height: ch }).resize(1920, 1080, { fit: "fill" }).webp({ quality: 82 }).toBuffer();
  } else {
    card = await sharp(oriented.data).resize(1920, 1080, { fit: "cover", position: sharp.strategy.attention }).webp({ quality: 82 }).toBuffer();
  }
  const thumb = await sharp(card).resize(640, 360).webp({ quality: 80 }).toBuffer();
  return { full: full.data, card, thumb, width: full.info.width, height: full.info.height, contentType: "image/webp" };
}

// What the database keeps as the receipt: the manifest without the image bytes.
export function receiptPayload(manifest: PhotoInbox) {
  const { image, ...rest } = manifest;
  return { ...rest, imageSha256: image.sha256 };
}
