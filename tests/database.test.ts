import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviewIssues, recipeInboxSchema } from "../lib/sync-import";
import { activeVersions, canBake, type Version } from "../lib/domain";

const db = new PGlite();
const baker = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const workspace = "20000000-0000-4000-8000-000000000001";
const outside = "20000000-0000-4000-8000-000000000002";
const version = "30000000-0000-4000-8000-000000000001";
const recipe = "40000000-0000-4000-8000-000000000001";
const record = "50000000-0000-4000-8000-000000000001";
const client = "60000000-0000-4000-8000-000000000001";
const audience = "https://baking.example.com/api/mcp";
async function as(role: "anon" | "authenticated" | "postgres" | "baking_recipe_runner" | "baking_plan_runner", claims: object = {}) {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claims','${JSON.stringify(claims)}',false)`);
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
    grant select, insert on storage.objects to anon, authenticated;
  `);
  for (const file of ["202611220001_workspace.sql", "202611220002_integration.sql", "202611220003_photo_references.sql", "202611220004_chatgpt_recipe_sync.sql", "202611220005_direct_recipe_publish.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${baker}'), ('${other}');
    insert into public.workspaces values ('${workspace}', 'Kitchen'), ('${outside}', 'Private kitchen');
    insert into public.workspace_members values ('${workspace}', '${baker}', 'baker'), ('${outside}', '${other}', 'admin');
    insert into public.baking_oauth_grants values ('${client}', '${workspace}', '${baker}', '${audience}', false);
    insert into baking_import.configuration values ('recipe', '${workspace}'), ('plan', '${workspace}');
  `);
}, 20000);

afterAll(() => db.close());

describe("Supabase migration RLS in PostgreSQL", () => {
  it("blocks anonymous access to records and storage objects", async () => {
    await as("anon");
    await expect(db.query("select * from public.recipe_versions")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from public.planner_records")).rejects.toMatchObject({ code: "42501" });
    expect((await db.query("select * from storage.objects")).rows).toEqual([]);
  });
  it("scopes records and private photographs to their workspace", async () => {
    await as("authenticated", { sub: baker });
    expect((await db.query("select id from public.workspaces")).rows).toEqual([{ id: workspace }]);
    await expect(db.query("insert into public.planner_records (id,workspace_id,kind,document) values ($1,$2,'event','{}')", [record, outside])).rejects.toMatchObject({ code: "42501" });
    await db.query("insert into storage.objects (bucket_id,name) values ('baking-photos',$1)", [`${workspace}/example.jpg`]);
    await as("authenticated", { sub: other });
    expect((await db.query("select name from storage.objects")).rows).toEqual([]);
    await expect(db.query("insert into storage.objects (bucket_id,name) values ('baking-photos',$1)", [`${workspace}/example.jpg`])).rejects.toMatchObject({ code: "42501" });
  });
  it("inserts recipe versions idempotently and keeps previous versions immutable", async () => {
    await as("authenticated", { sub: baker });
    const draft = JSON.stringify({ name: "Cookie", status: "Draft" });
    await db.query("select public.save_recipe_version($1,$2,$3,$4)", [workspace, recipe, version, draft]);
    await db.query("select public.save_recipe_version($1,$2,$3,$4)", [workspace, recipe, version, draft]);
    await expect(db.query("select public.save_recipe_version($1,$2,$3,$4)", [workspace, recipe, version, '{"name":"Changed"}'])).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("update public.recipe_versions set document = '{}'" )).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("insert into public.recipe_approvals(workspace_id,recipe_id,version_id) values ($1,$2,$3)", [workspace, recipe, version])).rejects.toMatchObject({ code: "23514" });
  });
  it("checks revisions and isolates read-only OAuth grants and media", async () => {
    await as("authenticated", { sub: baker });
    await db.query("insert into public.planner_records (id,workspace_id,kind,document) values ($1,$2,'event','{}')", [record, workspace]);
    await db.query("update public.planner_records set document = '{\"date\":\"2026-11-22\"}', revision=1 where id=$1 and revision=0", [record]);
    expect((await db.query("update public.planner_records set revision=1 where id=$1 and revision=0 returning id", [record])).rows).toEqual([]);
    await as("authenticated", { sub: baker, client_id: client, aud: audience });
    expect((await db.query("select id from public.planner_records")).rows).toEqual([{ id: record }]);
    expect((await db.query("select name from storage.objects")).rows).toEqual([]);
    expect((await db.query("update public.planner_records set revision=2 where id=$1 returning id", [record])).rows).toEqual([]);
    await as("authenticated", { sub: baker, client_id: client, aud: "wrong-audience" });
    expect((await db.query("select id from public.planner_records")).rows).toEqual([]);
  });
});

describe("OAuth grants on direct database requests", () => {
  it("rechecks allowlisted client access and prevents destructive changes with a writable grant", async () => {
    await as("postgres");
    await db.query("update public.baking_oauth_grants set can_write = true where client_id=$1", [client]);
    await db.query("update public.planner_records set revision = revision + 1, document = $2::jsonb where id=$1", [record, JSON.stringify({ status: "Scheduled", excludedDates: [] })]);
    const hook = await db.query<{ token: { claims: { aud: string; baking_write: boolean } } }>(
      "select public.baking_oauth_token_hook($1::jsonb) as token", [JSON.stringify({ user_id: baker, client_id: client, claims: { aud: "authenticated" } })],
    );
    expect(hook.rows[0].token.claims).toMatchObject({ aud: audience, baking_write: true });
    await as("authenticated", { sub: baker, client_id: client, aud: audience });
    await expect(db.query("update public.planner_records set revision = revision + 1, document = $2::jsonb where id=$1", [record, JSON.stringify({ status: "Cancelled", excludedDates: [] })])).rejects.toMatchObject({ code: "42501" });
    const changed = await db.query("update public.planner_records set revision = revision + 1, document = $2::jsonb where id=$1 returning id", [record, JSON.stringify({ status: "Draft", excludedDates: [] })]);
    expect(changed.rows).toEqual([{ id: record }]);
    await as("postgres");
    await db.query("delete from public.baking_oauth_grants where client_id=$1", [client]);
    await as("authenticated", { sub: baker, client_id: client, aud: audience });
    expect((await db.query("select id from public.planner_records")).rows).toEqual([]);
  });
});

describe("the GitHub recipe inbox", () => {
  const sha = "a".repeat(40);
  async function submit(input: unknown) {
    const parsed = recipeInboxSchema.parse(input);
    const result = await db.query<{ result: { status: string; recipeId: string; versionId: string; replayed: boolean } }>(
      "select baking_import.submit_recipe($1::jsonb,$2::text[],$3) as result",
      [JSON.stringify(parsed), parsed.kind === "recipe" ? reviewIssues(parsed) : [], sha],
    );
    return result.rows[0].result;
  }
  it("replays imports, matches regenerated IDs, protects approved versions and isolates roles", async () => {
    const fixture = JSON.parse(await readFile(new URL("../recipe-imports/examples/recipe.json", import.meta.url), "utf8"));
    await as("baking_recipe_runner");
    const first = await submit(fixture);
    expect(first.status).toBe("ready_for_review");
    expect(await submit(fixture)).toMatchObject({ recipeId: first.recipeId, versionId: first.versionId, replayed: true });
    await expect(submit({ ...fixture, recipe: { ...fixture.recipe, notes: "A reused UUID with different content." } })).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("select * from public.recipe_versions")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select baking_import.submit_plan('{}','')")).rejects.toMatchObject({ code: "42501" });
    await as("authenticated", { sub: other });
    expect((await db.query("select id from public.recipe_imports")).rows).toEqual([]);
    await expect(db.query("select public.review_baking_recipe_import($1,'approve')", [fixture.importId])).rejects.toMatchObject({ code: "42501" });
    await as("authenticated", { sub: baker });
    const approved = (await db.query<{ id:string }>("select public.review_baking_recipe_import($1,'approve') as id", [fixture.importId])).rows[0].id;
    await as("baking_recipe_runner");
    const ids = fixture.recipe.ingredients.map(() => crypto.randomUUID());
    const duplicate = await submit({ ...fixture, importId: crypto.randomUUID(), recipeKey: "alternate-slug",
      recipe: { ...fixture.recipe, name: "Example only: CINNAMON SUGAR TOPPING!",
        ingredients: fixture.recipe.ingredients.map((ingredient: object, index: number) => ({ ...ingredient, id: ids[index] })),
        steps: [{ ...fixture.recipe.steps[0], id: crypto.randomUUID(), ingredients: ids }] } });
    expect(duplicate).toMatchObject({ status: "already_exists", recipeId: first.recipeId, versionId: approved });
    const lookup = await submit({ schemaVersion: 1, kind: "lookup", importId: crypto.randomUUID(), recipeKey: "alternate-slug", name: "Demo cinnamon sugar" });
    expect(lookup).toMatchObject({ status: "found", recipeId: first.recipeId });
    const changedId = crypto.randomUUID();
    const changed = await submit({ ...fixture, importId: changedId, recipe: { ...fixture.recipe, yieldLow: 15, changeReason: "Changed yield." } });
    expect(changed).toMatchObject({ status: "ready_for_review", recipeId: first.recipeId });
    const incomplete = await submit({ ...fixture, importId: crypto.randomUUID(), verification: "Needs review", recipe: { ...fixture.recipe, yieldLow: null } });
    expect(incomplete).toMatchObject({ status: "incomplete", versionId: null });
    await as("authenticated", { sub: baker });
    expect((await db.query("select version_id from public.recipe_approvals where recipe_id=$1", [first.recipeId])).rows).toEqual([{ version_id: approved }]);
    const revision = (await db.query<{document:{yieldLow:number;status:string}}>("select document from public.recipe_versions where id=$1", [changed.versionId])).rows[0];
    expect(revision.document).toMatchObject({ yieldLow: 15, status: "Draft" });
    await db.query("select public.review_baking_recipe_import($1,'reject')", [changedId]);
    expect((await db.query("select status from public.recipe_imports where id=$1", [changedId])).rows).toEqual([{ status: "rejected" }]);
    await expect(db.query("select baking_import.submit_recipe('{}','{}','')")).rejects.toMatchObject({ code: "42501" });
  });

  it("imports a date-only event once and requires the current revision for changes", async () => {
    const recordId = crypto.randomUUID();
    const payload = {
      schemaVersion: 1, importId: crypto.randomUUID(), kind: "event", recordId,
      event: { title: "Inbox calendar test", date: "2026-11-27", category: "Personal baking", status: "Scheduled",
        recipes: [], notes: "", recurrence: "None", excludedDates: [] },
    };
    await as("baking_plan_runner");
    const plan = (input: object) => db.query("select baking_import.submit_plan($1::jsonb,$2) as result", [JSON.stringify(input), sha]);
    expect((await plan(payload)).rows).toEqual([{ result: { status: "saved", revision: 0, replayed: false } }]);
    expect((await plan(payload)).rows).toEqual([{ result: { status: "saved", revision: 0, replayed: true } }]);
    const updated = { ...payload, importId: crypto.randomUUID(), event: { ...payload.event, date: "2026-11-28" } };
    await expect(plan(updated)).rejects.toMatchObject({ code: "40001" });
    expect((await plan({ ...updated, expectedRevision: 0 })).rows).toEqual([{ result: { status: "saved", revision: 1, replayed: false } }]);
    await expect(db.query("select * from public.recipe_imports")).rejects.toMatchObject({ code: "42501" });
    await as("authenticated", { sub: baker });
    expect((await db.query("select document->>'date' as date, document ? 'start' as has_start from public.planner_records where id=$1", [recordId])).rows)
      .toEqual([{ date: "2026-11-28", has_start: false }]);
  });
});

describe("direct publication from the recipe inbox", () => {
  const sha = "b".repeat(40);
  type Result = { status: string; recipeId: string; versionId: string; eventId: string | null; replayed: boolean };
  async function submit(input: unknown) {
    const parsed = recipeInboxSchema.parse(input);
    const result = await db.query<{ result: Result }>("select baking_import.submit_recipe($1::jsonb,$2::text[],$3) as result",
      [JSON.stringify(parsed), parsed.kind === "recipe" ? reviewIssues(parsed) : [], sha]);
    return result.rows[0].result;
  }
  async function library() {
    await as("authenticated", { sub: baker });
    const versions = (await db.query<Version>("select id, recipe_id, created_at::text, document from public.recipe_versions order by created_at desc, id")).rows;
    const approvals = Object.fromEntries((await db.query<{ recipe_id: string; version_id: string }>("select recipe_id, version_id from public.recipe_approvals")).rows
      .map((row) => [row.recipe_id, row.version_id]));
    await as("baking_recipe_runner");
    return { versions, approvals, favorites: [] as string[] };
  }
  const base = async (key: string) => {
    const fixture = JSON.parse(await readFile(new URL("../recipe-imports/examples/recipe-publish.json", import.meta.url), "utf8"));
    const name = `Publish test ${key}`;
    return { ...fixture, importId: crypto.randomUUID(), recipeKey: key, aliases: [], sourceKey: undefined, recipe: { ...fixture.recipe, name } };
  };

  it("publishes a finalized recipe as the preferred, bakeable version and schedules the requested date", async () => {
    const input = await base("publish-ready");
    await as("baking_recipe_runner");
    const first = await submit(input);
    expect(first).toMatchObject({ status: "published", replayed: false });
    expect(first.eventId).toEqual(expect.any(String));
    // Replays and regenerated IDs neither add versions nor events.
    expect(await submit(input)).toMatchObject({ status: "published", versionId: first.versionId, eventId: first.eventId, replayed: true });
    const again = await submit({ ...input, importId: crypto.randomUUID(), schedule: undefined });
    expect(again).toMatchObject({ status: "already_published", recipeId: first.recipeId, versionId: first.versionId, eventId: null });
    const lib = await library();
    expect(lib.versions.filter((item) => item.recipe_id === first.recipeId)).toHaveLength(1);
    expect(lib.approvals[first.recipeId]).toBe(first.versionId);
    const preferred = activeVersions(lib).find((item) => item.recipe_id === first.recipeId)!;
    // Untested formulas are Ready for Testing, which the Start baking picker accepts.
    expect(preferred.document.status).toBe("Ready for Testing");
    expect(canBake(preferred.document) && ["Ready for Testing", "Tested"].includes(preferred.document.status)).toBe(true);
    await as("authenticated", { sub: baker });
    const events = (await db.query<{ document: { date: string; start: string; status: string; recipes: { versionId: string; target: number }[] } }>(
      "select document from public.planner_records where id=$1", [first.eventId])).rows;
    expect(events[0].document).toMatchObject({ date: "2026-12-05", start: "10:00", status: "Scheduled", recipes: [{ versionId: first.versionId, target: 24 }] });
    const receipt = (await db.query("select status, approved_version_id, event_id from public.recipe_imports where id=$1", [input.importId])).rows[0];
    expect(receipt).toEqual({ status: "published", approved_version_id: first.versionId, event_id: first.eventId });
  });

  it("marks a version Tested only with a confirmed bake and keeps earlier versions for rollback", async () => {
    const input = await base("publish-history");
    await as("baking_recipe_runner");
    const untested = await submit(input);
    const changed = await submit({ ...input, importId: crypto.randomUUID(), tested: { testedOn: "2026-11-20" },
      recipe: { ...input.recipe, yieldLow: 24, changeReason: "Doubled batch." } });
    expect(changed).toMatchObject({ status: "published", recipeId: untested.recipeId });
    let lib = await library();
    const history = lib.versions.filter((item) => item.recipe_id === untested.recipeId);
    expect(history.map((item) => item.document.status).sort()).toEqual(["Ready for Testing", "Tested"]);
    expect(lib.approvals[untested.recipeId]).toBe(changed.versionId);
    await as("authenticated", { sub: baker });
    await db.query("update public.recipe_approvals set version_id=$1 where recipe_id=$2", [untested.versionId, untested.recipeId]);
    lib = await library();
    expect(lib.approvals[untested.recipeId]).toBe(untested.versionId);
    expect(() => recipeInboxSchema.parse({ ...input, publicationIntent: undefined, tested: { testedOn: "2026-11-20" } })).toThrow();
  });

  it("keeps incomplete or inconsistent recipes as drafts and saves drafts without publishing", async () => {
    const input = await base("publish-blocked");
    await as("baking_recipe_runner");
    const missing = await submit({ ...input, recipe: { ...input.recipe, ingredients: [{ ...input.recipe.ingredients[0], quantity: null }, input.recipe.ingredients[1]] } });
    expect(missing).toMatchObject({ status: "incomplete", versionId: null });
    expect(missing.eventId).toEqual(expect.any(String));
    const heavy = await submit({ ...input, importId: crypto.randomUUID(), portionWeightGrams: 0.5, schedule: undefined });
    expect(heavy).toMatchObject({ status: "incomplete", versionId: null });
    const flagged = await submit({ ...input, importId: crypto.randomUUID(), schedule: undefined, issues: ["Dough mass does not match six portions."] });
    expect(flagged).toMatchObject({ status: "incomplete" });
    const draft = await submit({ ...input, importId: crypto.randomUUID(), publicationIntent: undefined, schedule: undefined });
    expect(draft).toMatchObject({ status: "ready_for_review" });
    const lib = await library();
    expect(lib.approvals[draft.recipeId]).toBeUndefined();
    expect(lib.versions.find((item) => item.id === draft.versionId)?.document.status).toBe("Draft");
    await as("authenticated", { sub: baker });
    const event = (await db.query<{ document: { recipes: unknown[]; notes: string } }>("select document from public.planner_records where id=$1", [missing.eventId])).rows[0];
    expect(event.document.recipes).toEqual([]);
    expect(event.document.notes).toContain("working draft");
    const receipt = (await db.query<{ issues: string[] }>("select issues from public.recipe_imports where id=$1", [input.importId])).rows[0];
    expect(receipt.issues.join(" ")).toMatch(/amount and unit/);
  });

  it("still rejects publishing calls from app users", async () => {
    await as("authenticated", { sub: baker });
    await expect(db.query("select baking_import.submit_recipe('{}','{}','')")).rejects.toMatchObject({ code: "42501" });
  });
});
