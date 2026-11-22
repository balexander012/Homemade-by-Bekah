"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Doc, type Entry, type Kind, type Recipe, type Version, recipeSchema, canBake } from "./domain";
import { approveVersion, ConflictError, emptyLibrary, loadWorkspace, saveRecord, saveVersion, validatedDocument } from "./store";
import { sampleData } from "./sample";
import type { Receipt } from "@/components/recipe-review";

type Pending = { base: number | null; entry: Entry; conflict?: boolean };
type Snapshot = Awaited<ReturnType<typeof loadWorkspace>> & { queue: Record<string, Pending> };

const empty: Snapshot = { records: [], library: emptyLibrary, queue: {} };

function replace(entries: Entry[], entry: Entry) {
  return entries.some((item) => item.id === entry.id) ? entries.map((item) => item.id === entry.id ? entry : item) : [...entries, entry];
}
function readCache(key: string, demo: boolean): Snapshot {
  try {
    const existing = JSON.parse(localStorage.getItem(key) ?? "null") as Snapshot | null;
    if (existing && Array.isArray(existing.records) && existing.library && existing.queue) return existing;
  } catch {
    // An unreadable cache can be rebuilt from Supabase.
  }
  return demo ? { ...sampleData(), queue: {} } : empty;
}

export function useWorkspace(client: SupabaseClient | null, workspace: string, identity: string, demo: boolean) {
  const key = `bekah-v1:${identity}:${workspace}`;
  const [data, setData] = useState(() => readCache(key, demo));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(navigator.onLine && !demo && !data.records.length && !data.library.versions.length);
  const [online, setOnline] = useState(() => navigator.onLine);
  const ref = useRef(data);
  const inflight = useRef(false);
  const mounted = useRef(true);
  const commit = useCallback((updated: Snapshot) => {
    if (!mounted.current) return;
    ref.current = updated;
    setData(updated);
    try { localStorage.setItem(key, JSON.stringify(updated)); }
    catch { setError("Device storage is full or unavailable. Keep this page open until changes sync."); }
  }, [key]);

  const sync = useCallback(async () => {
    if (!client || !navigator.onLine || inflight.current) return;
    inflight.current = true;
    try {
      for (const [id, pending] of Object.entries(ref.current.queue)) {
        if (pending.conflict || ref.current.queue[id] !== pending) continue;
        try {
          const saved = await saveRecord(client, workspace, pending.entry, pending.base);
          if (!mounted.current) return;
          const snapshot = ref.current;
          const queue = { ...snapshot.queue };
          const latest = queue[id];
          if (latest === pending) {
            delete queue[id];
            commit({ ...snapshot, queue, records: replace(snapshot.records, saved) });
          } else if (latest) {
            queue[id] = { ...latest, base: saved.revision };
            commit({ ...snapshot, queue });
          }
        } catch (cause) {
          if (!(cause instanceof ConflictError)) throw cause;
          const snapshot = ref.current;
          if (snapshot.queue[id]) commit({ ...snapshot, queue: { ...snapshot.queue,
            [id]: { ...snapshot.queue[id], conflict: true } } });
        }
      }
      const remote = await loadWorkspace(client, workspace);
      const snapshot = ref.current;
      const records = Object.values(snapshot.queue).reduce((rows, item) => replace(rows, item.entry), remote.records);
      commit({ ...remote, records, queue: snapshot.queue });
      if (mounted.current) setError("");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Workspace could not sync.");
    } finally {
      inflight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [client, commit, workspace]);

  useEffect(() => {
    mounted.current = true;
    const change = () => { setOnline(navigator.onLine); void sync(); };
    void sync();
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    window.addEventListener("focus", change);
    const interval = setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 12000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
      window.removeEventListener("focus", change);
    };
  }, [sync]);

  function put<K extends Kind>(kind: K, value: Doc<K>, id = crypto.randomUUID() as string, createOnly = false) {
    const document = validatedDocument(kind, value);
    const snapshot = ref.current;
    const existing = snapshot.records.find((item) => item.id === id);
    if (createOnly && existing) return id;
    const pending = snapshot.queue[id];
    const base = pending ? pending.base : existing?.revision ?? null;
    const entry = { id, kind, revision: base === null ? 0 : base + 1, document } as Entry;
    commit({ ...snapshot, records: replace(snapshot.records, entry), queue: demo ? snapshot.queue : {
      ...snapshot.queue, [id]: { base, entry, conflict: pending?.conflict },
    } });
    void sync();
    return id;
  }

  async function resolve(id: string, keepOnDevice: boolean) {
    if (!client) return;
    try {
      const remote = await loadWorkspace(client, workspace);
      const item = remote.records.find((record) => record.id === id);
      const snapshot = ref.current;
      const pending = snapshot.queue[id];
      if (!pending) return;
      const queue = { ...snapshot.queue };
      if (keepOnDevice) queue[id] = { ...pending, base: item?.revision ?? null, conflict: false };
      else delete queue[id];
      commit({
        ...snapshot, queue,
        records: keepOnDevice ? snapshot.records : item ? replace(snapshot.records, item) : snapshot.records.filter((record) => record.id !== id),
      });
      void sync();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resolve the conflict."); }
  }

  async function addRecipe(recipe: Recipe, recipeId = crypto.randomUUID() as string) {
    const document = recipeSchema.parse(recipe);
    const version: Version = { id: crypto.randomUUID(), recipe_id: recipeId, created_at: new Date().toISOString(), document };
    if (client) await saveVersion(client, workspace, recipeId, version.id, document);
    const snapshot = ref.current;
    commit({ ...snapshot, library: { ...snapshot.library, versions: [version, ...snapshot.library.versions.filter((item) => item.id !== version.id)] } });
    return version;
  }

  async function approve(version: Version) {
    if (!["Tested", "Ready for Testing"].includes(version.document.status) || !canBake(version.document)) throw new Error("Only a complete version that is ready or tested can be preferred.");
    if (client) await approveVersion(client, workspace, version.recipe_id, version.id);
    const snapshot = ref.current;
    commit({ ...snapshot, library: { ...snapshot.library, approvals: { ...snapshot.library.approvals, [version.recipe_id]: version.id } } });
  }

  async function favorite(id: string) {
    const isFavorite = ref.current.library.favorites.includes(id);
    if (client) {
      const result = await client.from("recipes").update({ favorite: !isFavorite }).eq("workspace_id", workspace).eq("id", id);
      if (result.error) throw new Error(result.error.message);
    }
    const snapshot = ref.current;
    const favorites = snapshot.library.favorites.filter((item) => item !== id);
    commit({ ...snapshot, library: { ...snapshot.library, favorites: isFavorite ? favorites : [...favorites, id] } });
  }

  async function importWebsite(url: string) {
    const { data } = await client?.auth.getSession() ?? { data: null };
    if (!data?.session) throw new Error("Sign in to import a recipe from a website.");
    const response = await fetch("/api/recipe-source", { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`,
    }, body: JSON.stringify({ url }) });
    const result = await response.json() as { recipe?: Recipe; error?: string };
    if (!response.ok || !result.recipe) throw new Error(result.error ?? "The recipe could not be imported.");
    return result.recipe;
  }

  const loadRecipeImports = useCallback(async (): Promise<Receipt[]> => {
    if (!client) return [];
    const all: Receipt[] = [];
    for (let start = 0; ; start += 100) {
      const { data, error } = await client.from("recipe_imports")
        .select("id,recipe_id,version_id,previous_version_id,baseline_approval_id,imported_at,status,issues,payload")
        .eq("workspace_id", workspace).filter("payload->>kind", "eq", "recipe")
        .in("status", ["ready_for_review", "incomplete", "approved", "rejected", "published", "already_published"])
        .order("imported_at", { ascending: false }).order("id").range(start, start + 99);
      if (error) throw new Error(error.message);
      all.push(...(data as Receipt[]));
      if (data.length < 100) return all;
    }
  }, [client, workspace]);

  async function reviewRecipeImport(importId: string, decision: "approve" | "reject"): Promise<string | null> {
    if (!client) throw new Error("Sign in to review imported recipes.");
    const { data, error } = await client.rpc("review_baking_recipe_import", { import_id: importId, decision });
    if (error) throw new Error(error.message);
    return data;
  }

  return { ...data, error, loading, online, put, addRecipe, approve, favorite, resolve, sync, importWebsite, loadRecipeImports, reviewRecipeImport };
}

export type WorkspaceStore = ReturnType<typeof useWorkspace>;
