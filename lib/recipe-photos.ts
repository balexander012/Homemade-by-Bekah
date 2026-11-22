"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Crop = { x: number; y: number; zoom: number; rotation: 0 | 90 | 180 | 270 };
export type RecipePhoto = {
  id: string; recipe_id: string; path: string; card_path: string; thumb_path: string; is_primary: boolean; position: number;
  caption: string; original_filename: string; width: number; height: number; content_type: string; content_hash: string;
  source: "app" | "chatgpt"; crop: Crop; state: "staged" | "stored"; created_at: string;
};
export type Variant = "full" | "card" | "thumb";
export type Rendered = { full: Blob; card: Blob; thumb: Blob; width: number; height: number; type: "image/webp" | "image/jpeg" };

export const defaultCrop: Crop = { x: 0.5, y: 0.5, zoom: 1, rotation: 0 };
export const photoAccept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const maxUpload = 30 * 1024 * 1024;

// The device's own decoder applies EXIF orientation (Safari decodes HEIC on Apple devices).
export async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  const heic = /heic|heif/i.test(blob.type) || (blob instanceof File && /\.(heic|heif)$/i.test(blob.name));
  if (blob instanceof File && blob.size > maxUpload) throw new Error(`${blob.name} is larger than 30 MB.`);
  if (blob.type && !/^image\/(jpeg|png|webp|heic|heif)$/i.test(blob.type) && !heic) {
    throw new Error(`${blob instanceof File ? blob.name : "This file"} is not a JPEG, PNG, WebP or HEIC photo.`);
  }
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error(heic ? "This browser can't open HEIC photos. Use Safari, or set the iPhone camera to Most Compatible, or export the photo as JPEG."
        : `${blob instanceof File ? blob.name : "This photo"} could not be opened.`);
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
const size = (image: ImageBitmap | HTMLImageElement) => ({ w: "naturalWidth" in image ? image.naturalWidth : image.width, h: "naturalHeight" in image ? image.naturalHeight : image.height });

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This device can't process photos.");
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}
// Rotate by quarter turns into a new canvas, keeping every pixel.
export function rotated(image: ImageBitmap | HTMLImageElement | HTMLCanvasElement, rotation: Crop["rotation"]) {
  const { w, h } = image instanceof HTMLCanvasElement ? { w: image.width, h: image.height } : size(image);
  const turn = rotation === 90 || rotation === 270;
  const { c, ctx } = canvas(turn ? h : w, turn ? w : h);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -w / 2, -h / 2);
  return c;
}
// The 16:9 frame: cover the frame, then zoom and move the center point. Never stretches.
export function cropRect(w: number, h: number, crop: Crop) {
  const scale = Math.max(16 / w, 9 / h) * crop.zoom;
  const cw = Math.min(w, 16 / scale), ch = Math.min(h, 9 / scale);
  const left = Math.min(Math.max(crop.x * w - cw / 2, 0), w - cw);
  const top = Math.min(Math.max(crop.y * h - ch / 2, 0), h - ch);
  return { left, top, cw, ch };
}
export function drawCard(source: HTMLCanvasElement, crop: Crop, width: number) {
  const { left, top, cw, ch } = cropRect(source.width, source.height, crop);
  const { c, ctx } = canvas(width, (width * 9) / 16);
  ctx.drawImage(source, left, top, cw, ch, 0, 0, c.width, c.height);
  return c;
}
async function encode(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await new Promise<Blob | null>((done) => c.toBlob(done, "image/webp", quality));
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await new Promise<Blob | null>((done) => c.toBlob(done, "image/jpeg", Math.min(0.92, quality + 0.05)));
  if (!jpeg) throw new Error("This device could not save the photo.");
  return jpeg;
}
// Re-encoding through a canvas drops EXIF and location metadata.
export async function render(image: ImageBitmap | HTMLImageElement, crop: Crop): Promise<Rendered> {
  const turned = rotated(image, crop.rotation);
  const longest = Math.max(turned.width, turned.height);
  const ratio = Math.min(1, 2048 / longest);
  const { c: fullCanvas, ctx } = canvas(turned.width * ratio, turned.height * ratio);
  ctx.drawImage(turned, 0, 0, fullCanvas.width, fullCanvas.height);
  const [full, card, thumb] = await Promise.all([encode(fullCanvas, 0.86), encode(drawCard(turned, crop, 1920), 0.84), encode(drawCard(turned, crop, 640), 0.8)]);
  return { full, card, thumb, width: fullCanvas.width, height: fullCanvas.height, type: full.type === "image/webp" ? "image/webp" : "image/jpeg" };
}
export async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type NewPhoto = { file: File; rendered: Rendered; crop: Crop; caption: string; hash: string };
export type PhotoStore = ReturnType<typeof usePhotoStore>;

export function usePhotoStore(client: SupabaseClient | null, workspace: string) {
  const [photos, setPhotos] = useState<RecipePhoto[]>([]);
  const [error, setError] = useState("");
  const urls = useRef(new Map<string, string>());
  const demoBlobs = useRef(new Map<string, Blob>());
  const pending = useRef(new Map<string, Promise<string>>());

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.from("recipe_photos").select("*").eq("workspace_id", workspace).order("position").order("created_at");
    if (error) { setError(error.message); return; }
    setPhotos(data as RecipePhoto[]);
    // Move photos that arrived from ChatGPT into Storage from this signed-in device.
    for (const photo of (data as RecipePhoto[]).filter((item) => item.state === "staged")) {
      try {
        const staged = await client.rpc("read_staged_recipe_photo", { photo: photo.id });
        if (staged.error || !staged.data) continue;
        const bytes = staged.data as Record<Variant, string>;
        for (const [variant, path] of [["full", photo.path], ["card", photo.card_path], ["thumb", photo.thumb_path]] as const) {
          const blob = new Blob([Uint8Array.from(atob(bytes[variant]), (ch) => ch.charCodeAt(0))], { type: photo.content_type });
          const upload = await client.storage.from("baking-photos").upload(path, blob, { contentType: photo.content_type, upsert: true });
          if (upload.error) throw new Error(upload.error.message);
        }
        await client.rpc("finish_staged_recipe_photo", { photo: photo.id });
      } catch { /* Another device can finish it. The staged copy still displays. */ }
    }
    const trash = await client.from("recipe_photo_trash").select("path").eq("workspace_id", workspace);
    if (trash.data?.length) {
      const paths = trash.data.map((row) => row.path as string);
      const removed = await client.storage.from("baking-photos").remove(paths);
      if (!removed.error) await client.from("recipe_photo_trash").delete().in("path", paths);
    }
  }, [client, workspace]);
  useEffect(() => { void load(); }, [load]);

  // Signed URLs are not used: files download with the member's own session and stay private.
  const url = useCallback(async (photo: RecipePhoto, variant: Variant) => {
    const path = variant === "full" ? photo.path : variant === "card" ? photo.card_path : photo.thumb_path;
    const cached = urls.current.get(path);
    if (cached) return cached;
    let job = pending.current.get(path);
    if (!job) {
      job = (async () => {
        let blob: Blob | undefined = demoBlobs.current.get(path);
        if (!blob && client && photo.state === "staged") {
          const staged = await client.rpc("read_staged_recipe_photo", { photo: photo.id });
          if (staged.data) blob = new Blob([Uint8Array.from(atob((staged.data as Record<Variant, string>)[variant]), (ch) => ch.charCodeAt(0))], { type: photo.content_type });
        }
        if (!blob && client) {
          const download = await client.storage.from("baking-photos").download(path);
          if (download.error || !download.data) throw new Error("Photo unavailable");
          blob = download.data;
        }
        if (!blob) throw new Error("Photo unavailable");
        const objectUrl = URL.createObjectURL(blob);
        urls.current.set(path, objectUrl);
        return objectUrl;
      })();
      pending.current.set(path, job);
      job.catch(() => pending.current.delete(path));
    }
    return job;
  }, [client]);

  const forRecipe = useCallback((recipeId: string) => photos.filter((item) => item.recipe_id === recipeId).sort((a, b) => a.position - b.position), [photos]);
  const primary = useCallback((recipeId: string) => photos.find((item) => item.recipe_id === recipeId && item.is_primary), [photos]);

  async function put(path: string, blob: Blob) {
    if (!client) { demoBlobs.current.set(path, blob); return; }
    const result = await client.storage.from("baking-photos").upload(path, blob, { contentType: blob.type, upsert: false });
    if (result.error) throw new Error(result.error.message);
  }
  async function removeFiles(paths: string[]) {
    for (const path of paths) { const old = urls.current.get(path); if (old) URL.revokeObjectURL(old); urls.current.delete(path); demoBlobs.current.delete(path); }
    if (client) await client.storage.from("baking-photos").remove(paths);
  }
  const files = (recipeId: string, id: string, type: string) => {
    const stamp = Date.now().toString(36);
    const ext = type === "image/webp" ? "webp" : "jpg";
    const base = `${workspace}/recipes/${recipeId}/${id}`;
    return { path: `${base}-full-${stamp}.${ext}`, card_path: `${base}-card-${stamp}.${ext}`, thumb_path: `${base}-thumb-${stamp}.${ext}` };
  };

  async function add(recipeId: string, items: NewPhoto[], mainIndex: number | null, progress: (done: number) => void) {
    const current = photos.filter((item) => item.recipe_id === recipeId);
    let position = current.reduce((max, item) => Math.max(max, item.position + 1), 0);
    const added: RecipePhoto[] = [];
    for (const [index, item] of items.entries()) {
      if (current.some((photo) => photo.content_hash === item.hash) || added.some((photo) => photo.content_hash === item.hash)) {
        throw new Error(`${item.file.name} is already in this recipe's photos.`);
      }
      const id = crypto.randomUUID();
      const paths = files(recipeId, id, item.rendered.type);
      await put(paths.path, item.rendered.full);
      await put(paths.card_path, item.rendered.card);
      await put(paths.thumb_path, item.rendered.thumb);
      const row: RecipePhoto = { id, recipe_id: recipeId, ...paths, is_primary: false, position: position++, caption: item.caption.trim().slice(0, 300),
        original_filename: item.file.name.slice(0, 255), width: item.rendered.width, height: item.rendered.height, content_type: item.rendered.type,
        content_hash: item.hash, source: "app", crop: item.crop, state: "stored", created_at: new Date().toISOString() };
      if (client) {
        const { created_at: _created, ...insert } = row;
        const result = await client.from("recipe_photos").insert({ ...insert, workspace_id: workspace });
        if (result.error) { await removeFiles(Object.values(paths)); throw new Error(result.error.code === "23505" ? `${item.file.name} is already in this recipe's photos.` : result.error.message); }
      }
      added.push(row);
      setPhotos((list) => [...list, row]);
      progress(index + 1);
    }
    if (mainIndex !== null && added[mainIndex]) await setMain(added[mainIndex]);
    return added;
  }
  async function setMain(photo: RecipePhoto) {
    if (client) { const result = await client.rpc("set_recipe_primary_photo", { photo: photo.id }); if (result.error) throw new Error(result.error.message); }
    setPhotos((list) => list.map((item) => item.recipe_id === photo.recipe_id ? { ...item, is_primary: item.id === photo.id } : item));
  }
  async function update(photo: RecipePhoto, changes: Partial<Pick<RecipePhoto, "caption" | "position">>) {
    if (client) { const result = await client.from("recipe_photos").update(changes).eq("id", photo.id); if (result.error) throw new Error(result.error.message); }
    setPhotos((list) => list.map((item) => item.id === photo.id ? { ...item, ...changes } : item));
  }
  async function move(photo: RecipePhoto, direction: -1 | 1) {
    const list = forRecipe(photo.recipe_id);
    const index = list.findIndex((item) => item.id === photo.id);
    const other = list[index + direction];
    if (!other) return;
    await update(photo, { position: other.position });
    await update(other, { position: photo.position });
  }
  // Edit or replace keeps the photo's place, main-photo setting and caption, with new files.
  async function rewrite(photo: RecipePhoto, rendered: Rendered, crop: Crop, replacement?: { file: File; hash: string }) {
    if (replacement && photos.some((item) => item.recipe_id === photo.recipe_id && item.id !== photo.id && item.content_hash === replacement.hash)) {
      throw new Error("That photo is already in this recipe's photos.");
    }
    const paths = files(photo.recipe_id, photo.id, rendered.type);
    await put(paths.path, rendered.full);
    await put(paths.card_path, rendered.card);
    await put(paths.thumb_path, rendered.thumb);
    const changes = { ...paths, width: rendered.width, height: rendered.height, content_type: rendered.type, crop,
      ...(replacement ? { content_hash: replacement.hash, original_filename: replacement.file.name.slice(0, 255) } : {}) };
    if (client) {
      // A photo still waiting from ChatGPT is settled first so its staged copy can't overwrite this edit.
      if (photo.state === "staged") await client.rpc("finish_staged_recipe_photo", { photo: photo.id });
      const result = await client.from("recipe_photos").update(changes).eq("id", photo.id);
      if (result.error) {
        await removeFiles(Object.values(paths));
        throw new Error(result.error.code === "23505" ? "That photo is already in this recipe's photos." : result.error.message);
      }
    }
    await removeFiles([photo.path, photo.card_path, photo.thumb_path]);
    setPhotos((list) => list.map((item) => item.id === photo.id ? { ...item, ...changes, state: "stored" } : item));
  }
  async function remove(photo: RecipePhoto) {
    if (client) { const result = await client.from("recipe_photos").delete().eq("id", photo.id); if (result.error) throw new Error(result.error.message); }
    if (photo.state === "stored") await removeFiles([photo.path, photo.card_path, photo.thumb_path]);
    setPhotos((list) => list.filter((item) => item.id !== photo.id));
  }
  async function original(photo: RecipePhoto) {
    const response = await fetch(await url(photo, "full"));
    return response.blob();
  }

  return useMemo(() => ({ photos, error, load, url, forRecipe, primary, add, setMain, update, move, rewrite, remove, original }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photos, error, load, url, forRecipe, primary]);
}

export const PhotoContext = createContext<PhotoStore | null>(null);
export const usePhotos = () => useContext(PhotoContext);
