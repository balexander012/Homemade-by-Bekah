import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recipeInboxSchema, reviewIssues } from "../lib/sync-import";
import { importPhotos } from "../scripts/sync-photos";

const db = new PGlite();
const baker = "10000000-0000-4000-8000-000000000001";
const stranger = "10000000-0000-4000-8000-000000000002";
const workspace = "20000000-0000-4000-8000-000000000001";
const outside = "20000000-0000-4000-8000-000000000002";
type Role = "anon" | "authenticated" | "baking_recipe_runner";
async function as(role: Role, claims: object = {}) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claims','${JSON.stringify(claims)}',false)`);
}
const query = async (sql: string, params: unknown[]) => {
  await as("baking_recipe_runner");
  return db.query<{ result: Record<string, unknown> | null }>(sql, params);
};
let root = "";
let recipeId = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

async function photo(width: number, height: number, orientation?: number) {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 140, b: 60 } } })
    .composite([{ input: { create: { width: Math.round(width / 4), height: Math.round(height / 4), channels: 3, background: { r: 40, g: 20, b: 10 } } }, left: 10, top: 10 }]);
  return (orientation ? image.withMetadata({ orientation }) : image).jpeg({ quality: 90 }).toBuffer();
}
async function submit(bytes: Buffer, extra: object = {}, split = 0) {
  const importId = randomUUID();
  const data = bytes.toString("base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const image = split ? { contentType: "image/jpeg", sha256, parts: split } : { contentType: "image/jpeg", sha256, data };
  await writeFile(join(root, "photo-imports/pending", `${importId}.json`), JSON.stringify({
    schemaVersion: 1, kind: "photo", importId, recipeKey: "photo-test-cookies", image, ...extra }));
  if (split) {
    const size = Math.ceil(data.length / split);
    for (let index = 0; index < split; index++) {
      await writeFile(join(root, "photo-imports/pending", `${importId}.part-${String(index + 1).padStart(2, "0")}.txt`), data.slice(index * size, (index + 1) * size));
    }
  }
  git("add", "-A"); git("commit", "-qm", `photo ${importId}`);
  return importId;
}
async function rows() {
  await as("authenticated", { sub: baker });
  return (await db.query<{ id: string; is_primary: boolean; state: string; width: number; height: number; source: string; path: string }>(
    "select id, is_primary, state, width, height, source, path from public.recipe_photos where recipe_id=$1 order by position", [recipeId])).rows;
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:greatest(cardinality(string_to_array(name, '/'))-1,0)] $$;
    grant usage on schema auth, storage to anon, authenticated;
    grant select, insert, delete on storage.objects to anon, authenticated;
  `);
  for (const file of ["202611220001_workspace.sql", "202611220002_integration.sql", "202611220003_photo_references.sql",
    "202611220004_chatgpt_recipe_sync.sql", "202611220005_direct_recipe_publish.sql", "202611220006_recipe_photos.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${baker}'), ('${stranger}');
    insert into public.workspaces values ('${workspace}', 'Kitchen'), ('${outside}', 'Other kitchen');
    insert into public.workspace_members values ('${workspace}', '${baker}', 'baker'), ('${outside}', '${stranger}', 'admin');
    insert into baking_import.configuration values ('recipe', '${workspace}'), ('plan', '${workspace}');
  `);
  const fixture = JSON.parse(await readFile(new URL("../recipe-imports/examples/recipe-publish.json", import.meta.url), "utf8"));
  const parsed = recipeInboxSchema.parse({ ...fixture, recipeKey: "photo-test-cookies", aliases: [], sourceKey: undefined, schedule: undefined,
    recipe: { ...fixture.recipe, name: "Photo test cookies" } });
  await as("baking_recipe_runner");
  const created = await db.query<{ result: { recipeId: string } }>("select baking_import.submit_recipe($1::jsonb,$2::text[],$3) as result",
    [JSON.stringify(parsed), parsed.kind === "recipe" ? reviewIssues(parsed) : [], "c".repeat(40)]);
  recipeId = created.rows[0].result.recipeId;
  root = await mkdtemp(join(tmpdir(), "photo-inbox-"));
  git("init", "-q"); git("config", "user.email", "t@example.com"); git("config", "user.name", "Test");
  await mkdir(join(root, "photo-imports/pending"), { recursive: true });
}, 30000);
afterAll(() => db.close());

describe("ChatGPT photo imports through the GitHub inbox", () => {
  it("decodes, orients, crops to 16:9 and stages the photo as the main image, once", async () => {
    const bytes = await photo(2400, 1600, 6);
    const id = await submit(bytes, { setAsPrimary: true, caption: "Fresh from the oven", filename: "cookies.jpg" });
    const first = await importPhotos(root, query);
    expect(first.failures).toBe(0);
    expect(first.lines.join("\n")).toContain(`| ${id} | Photo added |`);
    const [saved] = await rows();
    // EXIF orientation 6 turns the 2400 x 1600 photo upright, then it is resized to 2048 on its long edge.
    expect(saved).toMatchObject({ is_primary: true, state: "staged", width: 1365, height: 2048, source: "chatgpt" });
    const staged = (await db.query<{ data: { card: string; thumb: string } }>("select public.read_staged_recipe_photo($1) as data", [saved.id])).rows[0].data;
    const card = await sharp(Buffer.from(staged.card, "base64")).metadata();
    const thumb = await sharp(Buffer.from(staged.thumb, "base64")).metadata();
    expect([card.format, card.width, card.height, card.orientation]).toEqual(["webp", 1920, 1080, undefined]);
    expect([thumb.width, thumb.height]).toEqual([640, 360]);
    // Retrying the same run and re-sending the same picture under a new import ID add nothing.
    const again = await importPhotos(root, query);
    expect(again.lines.join("\n")).toContain(`| ${id} | Photo added (replayed) |`);
    await submit(bytes, { setAsPrimary: false });
    const duplicate = await importPhotos(root, query);
    expect(duplicate.lines.join("\n")).toContain("Photo already in the gallery");
    expect(await rows()).toHaveLength(1);
  });

  it("adds gallery photos without changing the main photo, accepts split parts and can replace the main photo", async () => {
    await submit(await photo(1200, 900), { setAsPrimary: false });
    await submit(await photo(1000, 1000), {}, 3);
    expect((await importPhotos(root, query)).failures).toBe(0);
    let list = await rows();
    expect(list).toHaveLength(3);
    expect(list.filter((item) => item.is_primary)).toHaveLength(1);
    expect(list[0].is_primary).toBe(true);
    // A device moves the first photo into Storage, then a replacement removes it and queues its files for deletion.
    await db.query("select public.finish_staged_recipe_photo($1)", [list[0].id]);
    const replaced = list[0];
    await submit(await photo(1600, 900), { mode: "replacePrimary" });
    expect((await importPhotos(root, query)).failures).toBe(0);
    list = await rows();
    expect(list.map((item) => item.id)).not.toContain(replaced.id);
    expect(list.find((item) => item.is_primary)?.id).toBe(list.at(-1)?.id);
    await as("authenticated", { sub: baker });
    expect((await db.query("select path from public.recipe_photo_trash")).rows).toContainEqual({ path: replaced.path });
  });

  it("rejects altered, malformed and unmatched imports", async () => {
    const good = await photo(800, 600);
    const tampered = await submit(good, {});
    const manifest = JSON.parse(await readFile(join(root, "photo-imports/pending", `${tampered}.json`), "utf8"));
    manifest.image.sha256 = "0".repeat(64);
    await writeFile(join(root, "photo-imports/pending", `${tampered}.json`), JSON.stringify(manifest));
    const text = Buffer.from("this is not an image, just text pretending to be one");
    const fake = await submit(text, {});
    const truncated = await submit(good.subarray(0, 600), {});
    const unknown = await submit(await photo(640, 480), { recipeKey: "no-such-recipe" });
    const result = await importPhotos(root, query);
    const summary = result.lines.join("\n");
    expect(result.failures).toBe(4);
    expect(summary).toContain(`| ${tampered} | The image data does not match image.sha256`);
    expect(summary).toContain(`| ${fake} | The file is not a JPEG, PNG, WebP or HEIC image.`);
    expect(summary).toContain(`| ${truncated} | The image could not be decoded.`);
    expect(summary).toContain(`| ${unknown} | No matching recipe |`);
    expect(await rows()).toHaveLength(3);
  });

  it("limits photo changes to members of the recipe's workspace", async () => {
    const versionsBefore = (await (async () => { await as("authenticated", { sub: baker }); return db.query("select id from public.recipe_versions where recipe_id=$1", [recipeId]); })()).rows.length;
    const [first, second] = await rows();
    await as("authenticated", { sub: baker });
    await db.query("select public.set_recipe_primary_photo($1)", [second.id]);
    await db.query("update public.recipe_photos set caption='Gallery shot', position=9 where id=$1", [first.id]);
    expect((await rows()).find((item) => item.is_primary)?.id).toBe(second.id);
    // Another workspace's member sees nothing and changes nothing.
    await as("authenticated", { sub: stranger });
    expect((await db.query("select id from public.recipe_photos")).rows).toEqual([]);
    await db.query("update public.recipe_photos set caption='hijacked' where id=$1", [first.id]);
    await expect(db.query("select public.read_staged_recipe_photo($1)", [second.id])).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`insert into public.recipe_photos (id, workspace_id, recipe_id, path, card_path, thumb_path, width, height, content_type, content_hash)
      values ($1,$2,$3,$4,$4,$4,1,1,'image/webp',$5)`, [randomUUID(), workspace, recipeId, `${workspace}/recipes/${recipeId}/x.webp`, "a".repeat(64)])).rejects.toMatchObject({ code: "42501" });
    // Integration (OAuth) tokens can read but not change photos; anonymous visitors get nothing.
    await as("authenticated", { sub: baker, client_id: "integration" });
    await db.query("update public.recipe_photos set caption='oauth' where id=$1", [first.id]);
    await as("anon");
    await expect(db.query("select id from public.recipe_photos")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select baking_import.submit_photo('{}','{}','','','','')")).rejects.toMatchObject({ code: "42501" });
    await as("authenticated", { sub: baker });
    expect((await db.query<{ caption: string }>("select caption from public.recipe_photos where id=$1", [first.id])).rows[0].caption).toBe("Gallery shot");
    // Photo work never adds a recipe version.
    expect((await db.query("select id from public.recipe_versions where recipe_id=$1", [recipeId])).rows).toHaveLength(versionsBefore);
    expect(versionsBefore).toBe(1);
  });
});
