"use client";

import { useEffect, useState } from "react";
import { type Recipe, type Version } from "@/lib/domain";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Status, message } from "./ui";

export type Receipt = {
  id: string;
  recipe_id: string | null;
  version_id: string | null;
  previous_version_id: string | null;
  baseline_approval_id: string | null;
  imported_at: string;
  status: "ready_for_review" | "incomplete" | "approved" | "rejected";
  issues: string[];
  payload: { kind: "recipe"; recipe: Recipe; sourceReferences: string[]; finalizedOn?: string };
};

function RecipeFormula({ recipe }: { recipe: Recipe }) {
  return <div className="stack compact">
    <p>Yield · {recipe.yieldLow ? `${recipe.yieldLow}${recipe.yieldHigh ? `–${recipe.yieldHigh}` : ""} ${recipe.yieldUnit}` : "Needs confirmation"}</p>
    <h4>Ingredients</h4>
    <ul className="list-disc pl-5">
      {recipe.ingredients.map((ingredient) => <li key={ingredient.id}>
        {ingredient.quantity ?? "Amount to confirm"} {ingredient.unit} {ingredient.name}{ingredient.preparation && ` · ${ingredient.preparation}`}
      </li>)}
    </ul>
    <h4>Instructions</h4>
    <ol className="list-decimal pl-5">{recipe.steps.map((step) => <li key={step.id} className="whitespace-pre-wrap">
      {step.instruction}{step.temperature && ` · ${step.temperature} °F`}{step.minutes && ` · ${step.minutes} min`}
    </li>)}</ol>
    {recipe.storage && <p>Storage · {recipe.storage}</p>}
    {recipe.freezer && <p>Freezer · {recipe.freezer}</p>}
    {recipe.notes && <p className="whitespace-pre-wrap">{recipe.notes}</p>}
  </div>;
}

function changes(before: Recipe, after: Recipe) {
  const items: string[] = [];
  if ([before.yieldLow, before.yieldHigh, before.yieldUnit].join() !== [after.yieldLow, after.yieldHigh, after.yieldUnit].join()) items.push("Batch yield");
  if (JSON.stringify(before.ingredients.map(({ id: _id, ...item }) => item)) !== JSON.stringify(after.ingredients.map(({ id: _id, ...item }) => item))) items.push("Ingredients and preparation");
  const steps = (recipe: Recipe) => recipe.steps.map(({ id: _id, ingredients, ...step }) => ({
    ...step, ingredients: ingredients.map((id) => recipe.ingredients.findIndex((item) => item.id === id)).sort((a,b) => a-b),
  }));
  if (JSON.stringify(steps(before)) !== JSON.stringify(steps(after))) items.push("Instructions, temperatures or timing");
  if (before.storage !== after.storage || before.freezer !== after.freezer) items.push("Storage");
  if (JSON.stringify(before.prep) !== JSON.stringify(after.prep) || JSON.stringify(before.equipment) !== JSON.stringify(after.equipment)) items.push("Preparation or equipment");
  if (before.notes !== after.notes) items.push("Notes");
  return items;
}

function ReviewCard({ entry, previous, stale, busy, decide, show }: {
  entry: Receipt; previous?: Version; stale: boolean; busy: boolean;
  decide: (decision: "approve" | "reject") => Promise<void>; show: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<"approve" | "reject">();
  const [tested, setTested] = useState(false);
  const recipe = entry.payload.recipe;
  const changed = previous ? changes(previous.document, recipe) : [];
  const pending = entry.status === "ready_for_review" || entry.status === "incomplete";
  return <article className="panel stack compact">
    <div className="line"><h3>{recipe.name}</h3><Status>{{
      ready_for_review: "Ready for review", incomplete: "Needs details", approved: "Approved", rejected: "Rejected",
    }[entry.status]}</Status></div>
    <p className="muted">Imported {new Date(entry.imported_at).toLocaleDateString()}{entry.payload.finalizedOn && ` · Finalized ${entry.payload.finalizedOn}`}</p>
    <p>{recipe.source || "Source to confirm"}</p>
    {entry.issues.length > 0 && <ul className="notice warning list-disc pl-8">{entry.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    {stale && pending && <p className="notice warning">The approved recipe changed after this draft arrived. Open the draft and create a new revision from the current information before approving.</p>}
    <details><summary>Ingredients, instructions and sources</summary><div className="stack">
      <RecipeFormula recipe={recipe} />
      <ul className="list-disc pl-5">{entry.payload.sourceReferences.map((reference, index) => <li key={index}>{reference}</li>)}</ul>
    </div></details>
    {previous && <details><summary>Compare with the previous version</summary>
      <p>{changed.length ? changed.join(" · ") : "See both versions for differences in recipe details."}</p>
      {recipe.changeReason && <p>{recipe.changeReason}</p>}
      <div className="grid gap-4 md:grid-cols-2"><div><h4>Previous</h4><RecipeFormula recipe={previous.document} /></div>
        <div><h4>Imported draft</h4><RecipeFormula recipe={recipe} /></div></div>
    </details>}
    {pending && <div className="actions">
      {entry.version_id && <Button tone="ghost" onClick={() => show(entry.version_id!)}>Open draft</Button>}
      {entry.status === "ready_for_review" && !stale && <Button tone="secondary" disabled={busy} onClick={() => setConfirm("approve")}>Approve draft</Button>}
      <Button tone="ghost" disabled={busy} onClick={() => setConfirm("reject")}>Reject draft</Button>
    </div>}
    {confirm && <div className="notice stack">
      {confirm === "approve" ? <label className="check"><input type="checkbox" checked={tested} onChange={(event) => setTested(event.target.checked)} /><span>I tested this recipe and want to make it the preferred version.</span></label> :
        <p>Mark this import as rejected and keep its history?</p>}
      <div className="actions">
        <Button disabled={busy || (confirm === "approve" && !tested)} onClick={() => void decide(confirm).then(() => setConfirm(undefined)).catch(() => {})}>
          {confirm === "approve" ? "Confirm approval" : "Confirm rejection"}
        </Button>
        <Button tone="ghost" onClick={() => setConfirm(undefined)}>Cancel</Button>
      </div>
    </div>}
  </article>;
}

export function RecipeReview({ store, show, onRejected }: {
  store: WorkspaceStore; show: (id: string) => void; onRejected: (ids: string[]) => void;
}) {
  const { loadRecipeImports, reviewRecipeImport } = store;
  const [entries, setEntries] = useState<Receipt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let current = true;
    const refresh = () => void loadRecipeImports().then((rows) => {
      if (!current) return;
      setEntries(rows);
      onRejected(rows.filter((row) => row.status === "rejected").flatMap((row) => row.version_id ? [row.version_id] : []));
      setError("");
    }).catch((cause) => { if (current) setError(message(cause)); });
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) refresh(); }, 12000);
    return () => { current = false; clearInterval(timer); };
  }, [loadRecipeImports, onRejected]);

  const queue = entries.filter((entry) => entry.status === "ready_for_review" || entry.status === "incomplete");
  const visible = expanded ? entries : queue;
  async function decide(entry: Receipt, decision: "approve" | "reject") {
    setBusy(entry.id);
    setError("");
    try {
      const version = await reviewRecipeImport(entry.id, decision);
      const next = await loadRecipeImports();
      setEntries(next);
      onRejected(next.filter((row) => row.status === "rejected").flatMap((row) => row.version_id ? [row.version_id] : []));
      if (version) await store.sync();
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally { setBusy(undefined); }
  }

  if (!visible.length && entries.length <= queue.length && !error) return null;
  return <section className="stack" aria-label="Recipes to review">
    <div className="line"><h2>Recipes to review</h2>
      {entries.length > queue.length && <Button tone="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? "Show pending" : "Show import history"}</Button>}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!visible.length && <p className="muted">No recipe drafts from ChatGPT are waiting.</p>}
    {visible.map((entry) => <ReviewCard key={entry.id} entry={entry} busy={Boolean(busy)} show={show}
      previous={store.library.versions.find((version) => version.id === entry.previous_version_id)}
      stale={(entry.recipe_id ? store.library.approvals[entry.recipe_id] ?? null : null) !== entry.baseline_approval_id}
      decide={(decision) => decide(entry, decision)} />)}
  </section>;
}
