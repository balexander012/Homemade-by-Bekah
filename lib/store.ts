import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { schemas, recipeSchema, canBake, type Doc, type Entry, type Kind, type Library, type Recipe } from "./domain";

export const authStorageKey = "bekah-auth";
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function browserClient() {
  if (!supabaseUrl || !publishableKey) return null;
  return createClient(supabaseUrl, publishableKey, { auth: { storageKey: authStorageKey } });
}

export function tokenClient(token: string) {
  if (!supabaseUrl || !publishableKey) throw new Error("Configure Supabase to use the integration.");
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export const emptyLibrary: Library = { versions: [], favorites: [], approvals: {} };
export class ConflictError extends Error {}

export function recordsOf<K extends Kind>(records: Entry[], kind: K): Entry<K>[] {
  return records.filter((entry): entry is Entry<K> => entry.kind === kind);
}

async function pages<T>(select: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const pageSize = 250;
  const rows: T[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await select(start, start + pageSize - 1);
    if (error) throw new Error(error.message);
    if (data) rows.push(...data);
    if (!data || data.length < pageSize) return rows;
  }
}

export async function loadWorkspace(client: SupabaseClient, workspace: string) {
  const [records, versions, approvals, recipes] = await Promise.all([
    pages((start, end) => client.from("planner_records").select("id,kind,revision,document").eq("workspace_id", workspace).order("id").range(start, end)),
    pages((start, end) => client.from("recipe_versions").select("id,recipe_id,created_at,document").eq("workspace_id", workspace)
      .order("created_at", { ascending: false }).order("id").range(start, end)),
    pages((start, end) => client.from("recipe_approvals").select("recipe_id,version_id").eq("workspace_id", workspace).order("recipe_id").range(start, end)),
    pages((start, end) => client.from("recipes").select("id,favorite").eq("workspace_id", workspace).order("id").range(start, end)),
  ]);
  return {
    records: records as Entry[],
    library: {
      versions: versions as Library["versions"],
      favorites: recipes.filter((item) => item.favorite).map((item) => item.id),
      approvals: Object.fromEntries(approvals.map((item) => [item.recipe_id, item.version_id])),
    } satisfies Library,
  };
}

export function validatedDocument<K extends Kind>(kind: K, value: unknown): Doc<K> {
  return schemas[kind].parse(value) as Doc<K>;
}

function equalDocument(left: unknown, right: unknown): boolean {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
    return value;
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export async function saveRecord<K extends Kind>(client: SupabaseClient, workspace: string, entry: Entry<K>, base: number | null) {
  const document = validatedDocument(entry.kind, entry.document);
  const table = client.from("planner_records");
  const result = base === null
    ? await table.insert({ id: entry.id, workspace_id: workspace, kind: entry.kind, document }).select("id,kind,revision,document").single()
    : await table.update({ document, revision: base + 1 }).eq("id", entry.id).eq("workspace_id", workspace)
      .eq("kind", entry.kind).eq("revision", base).select("id,kind,revision,document").maybeSingle();
  if (result.data) return result.data as Entry<K>;
  if (result.error && result.error.code !== "23505") throw new Error(result.error.message);
  const existing = await table.select("id,kind,revision,document").eq("workspace_id", workspace).eq("id", entry.id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.kind === entry.kind && equalDocument(existing.data.document, document)) return existing.data as Entry<K>;
  throw new ConflictError("This item changed on another device.");
}

export async function saveVersion(client: SupabaseClient, workspace: string, recipeId: string, versionId: string, recipe: Recipe) {
  const result = await client.rpc("save_recipe_version", {
    workspace, recipe: recipeId, version: versionId, body: recipeSchema.parse(recipe),
  });
  if (result.error) {
    if (result.error.code === "23505") throw new ConflictError("This version identifier was already used.");
    throw new Error(result.error.message);
  }
}

export async function approveVersion(client: SupabaseClient, workspace: string, recipeId: string, versionId: string) {
  const version = await client.from("recipe_versions").select("document").eq("workspace_id", workspace)
    .eq("recipe_id", recipeId).eq("id", versionId).maybeSingle();
  if (version.error) throw new Error(version.error.message);
  if (!version.data || !["Tested", "Ready for Testing"].includes(version.data.document.status) || !canBake(version.data.document)) {
    throw new Error("Only a complete version that is ready or tested can be preferred.");
  }
  const table = client.from("recipe_approvals");
  const result = await table.insert({ workspace_id: workspace, recipe_id: recipeId, version_id: versionId });
  if (!result.error) return;
  if (result.error.code !== "23505") throw new Error(result.error.message);
  const update = await table.update({ version_id: versionId }).eq("workspace_id", workspace).eq("recipe_id", recipeId);
  if (update.error) throw new Error(update.error.message);
}
