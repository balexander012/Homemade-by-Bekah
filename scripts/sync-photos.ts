import { execFileSync } from "node:child_process";
import { appendFile, lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeImage, maxParts, photoInboxSchema, processImage, receiptPayload } from "../lib/photo-import";
import { openImporter } from "./inbox-db";

export const photoFolder = "photo-imports/pending";
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Query = (sql: string, params: unknown[]) => Promise<{ rows: { result: Record<string, unknown> | null }[] }>;

const labels: Record<string, string> = {
  added: "Photo added", already_exists: "Photo already in the gallery", recipe_not_found: "No matching recipe",
  ambiguous_recipe: "More than one recipe matches. Use existingRecipeId",
};

// Process every tracked manifest. Already-received imports are answered from their receipt without decoding again.
export async function importPhotos(root: string, query: Query, onlyId?: string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const tracked = git("ls-files", "-z", "--", photoFolder).split("\0").filter(Boolean);
  const manifests = tracked.filter((path) => path.endsWith(".json") && (!onlyId || path === `${photoFolder}/${onlyId}.json`));
  if (onlyId && !manifests.length) throw new Error("No tracked photo import matches the requested UUID.");
  const lines: string[] = [];
  let failures = 0;
  for (const path of manifests) {
    const id = path.slice(photoFolder.length + 1, -5);
    const row = (status: string, recipe = "—", photo = "—") => lines.push(`| ${id} | ${status} | ${recipe} | ${photo} |`);
    try {
      if (!idPattern.test(id)) throw new Error("Invalid filename");
      const stat = await lstat(resolve(root, path));
      if (!stat.isFile() || stat.size > 15 * 1024 * 1024) throw new Error("The manifest exceeds the size limit or is not a regular file.");
      const manifest = photoInboxSchema.parse(JSON.parse(await readFile(resolve(root, path), "utf8")));
      if (manifest.importId !== id) throw new Error("Filename and import ID disagree.");
      const payload = receiptPayload(manifest);
      const known = (await query("select baking_import.photo_receipt($1::uuid) as result", [id])).rows[0]?.result;
      if (known) {
        if (JSON.stringify(sortKeys(known.payload)) !== JSON.stringify(sortKeys(payload))) throw new Error("Import ID is already used by another request.");
        row(`${labels[String(known.status)] ?? String(known.status)} (replayed)`, String(known.recipeId), String(known.photoId));
        continue;
      }
      const parts: string[] = [];
      if (manifest.image.parts) {
        for (let index = 1; index <= Math.min(manifest.image.parts, maxParts); index++) {
          const part = `${photoFolder}/${id}.part-${String(index).padStart(2, "0")}.txt`;
          if (!tracked.includes(part)) throw new Error(`Missing ${part.split("/").pop()}.`);
          parts.push(await readFile(resolve(root, part), "utf8"));
        }
      }
      const { bytes, hash } = decodeImage(manifest, parts);
      const image = await processImage(bytes, manifest.crop);
      const sha = git("log", "-1", "--format=%H", "--", path).trim();
      const result = (await query("select baking_import.submit_photo($1::jsonb,$2::jsonb,$3::bytea,$4::bytea,$5::bytea,$6::text) as result", [
        JSON.stringify(payload), JSON.stringify({ sha256: hash, contentType: image.contentType, width: image.width, height: image.height }),
        image.full, image.card, image.thumb, sha,
      ])).rows[0].result!;
      const status = String(result.status);
      if (status === "recipe_not_found" || status === "ambiguous_recipe") failures++;
      row(labels[status] ?? "Unknown status", String(result.recipeId ?? "—"), String(result.photoId ?? "—"));
    } catch (error) {
      failures++;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const field = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
        ? ` (${error.issues.slice(0, 6).map((item: { path: unknown[] }) => item.path.map(String).join(".")).join(", ").replace(/[^\w., ]/g, "").slice(0, 160)})` : "";
      const reason = /^[A-Z0-9]{5}$/.test(code) ? `Database rejected import (${code})` :
        field ? `Invalid JSON or schema${field}` : error instanceof Error ? error.message.replace(/[|\n]/g, " ").slice(0, 200) : "Could not process";
      row(reason);
    }
  }
  if (!manifests.length) lines.push("| — | No photo imports | — | — |");
  return { lines, failures };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
  return value;
}

async function main() {
  const root = process.env.IMPORT_INBOX_ROOT ?? fileURLToPath(new URL("../", import.meta.url));
  const onlyId = process.env.IMPORT_ONLY_ID || undefined;
  if (onlyId && !idPattern.test(onlyId)) throw new Error("Provide a lowercase import UUID.");
  const header = ["# Photo inbox", "", "| Import ID | Result | Recipe ID | Photo ID |", "| --- | --- | --- | --- |"];
  const database = process.env.IMPORT_DATABASE_URL?.trim();
  let phase = "connection URL";
  let summary: string[];
  let failed = false;
  if (!database) { summary = ["| — | Database credential missing | — | — |"]; failed = true; }
  else {
    let client;
    try {
      client = await openImporter(database, "photo", (next) => { phase = next; });
      const db = client;
      const result = await importPhotos(root, (sql, params) => db.query(sql, params), onlyId);
      summary = result.lines;
      failed = result.failures > 0;
    } catch (error) {
      const raw = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      summary = [`| — | Could not open ${phase}${/^[A-Z0-9_]{3,50}$/.test(raw) ? ` (${raw})` : ""} | — | — |`];
      failed = true;
    } finally { try { await client?.end(); } catch { /* not connected */ } }
  }
  const text = `${[...header, ...summary].join("\n")}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text); else process.stdout.write(text);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch(() => { process.stderr.write("Photo import runner could not finish. Check inbox configuration.\n"); process.exitCode = 1; });
}
