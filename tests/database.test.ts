import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
async function as(role: "anon" | "authenticated" | "postgres", claims: object = {}) {
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
  for (const file of ["202611220001_workspace.sql", "202611220002_integration.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${baker}'), ('${other}');
    insert into public.workspaces values ('${workspace}', 'Kitchen'), ('${outside}', 'Private kitchen');
    insert into public.workspace_members values ('${workspace}', '${baker}', 'baker'), ('${outside}', '${other}', 'admin');
    insert into public.baking_oauth_grants values ('${client}', '${workspace}', '${baker}', '${audience}', false);
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
