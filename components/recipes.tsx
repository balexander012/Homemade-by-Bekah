"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, Plus, Star } from "lucide-react";
import { activeVersions, blankRecipe, categories, canBake, formatAmount, recipeStatuses, scale, type Recipe, type Version } from "@/lib/domain";
import { readRecipeFile, sourceFileTypes } from "@/lib/read-recipe-file";
import { parseRecipeImport } from "@/lib/recipe-import";
import { defaultPolicies } from "@/lib/sample";
import { recordsOf } from "@/lib/store";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, Status, message } from "./ui";
import { RecipeReview } from "./recipe-review";
import { RecipeImage, RecipePhotoSection } from "./recipe-photos";

const split = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);
const number = (text: string) => text === "" ? undefined : Number(text);

const filters = ["All", "Ready to bake", "Drafts", "Ideas", "Archived"] as const;
function filterMatch(filter: typeof filters[number], status: string, approved: boolean) {
  if (filter === "All") return status !== "Archived";
  if (filter === "Ready to bake") return approved || status === "Ready for Testing" || status === "Tested";
  if (filter === "Drafts") return status === "Draft";
  if (filter === "Ideas") return status === "Idea";
  return status === "Archived";
}

export function Recipes({ store, show, edit }: { store: WorkspaceStore; show: (id: string) => void; edit: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const [rejected, setRejected] = useState<string[]>([]);
  const versions = activeVersions({ ...store.library, versions: store.library.versions.filter((version) => !rejected.includes(version.id)) });
  const isApproved = (version: Version) => store.library.approvals[version.recipe_id] === version.id;
  const matches = versions.filter((version) => {
    const { recipe_id, document } = version;
    return filterMatch(filter, document.status, isApproved(version)) &&
      (!favorites || store.library.favorites.includes(recipe_id)) && (!category || document.category === category) &&
      [document.name, document.category, document.description, ...document.tags].join(" ").toLowerCase().includes(query.trim().toLowerCase());
  });
  return <>
    <Heading title="Recipes"><Button onClick={edit}><Plus size={20} /> New recipe</Button></Heading>
    <div className="stack">
      <RecipeReview store={store} show={show} onRejected={setRejected} />
      <div className="toolbar">
        <Field label="Search recipes"><input type="search" placeholder="Name, ingredient or tag" value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>{[...new Set([...categories, ...versions.map(({ document }) => document.category)])].map((name) => <option key={name}>{name}</option>)}
        </select></Field>
      </div>
      <div className="chips" role="group" aria-label="Recipe filters">
        {filters.map((name) => <button type="button" className="chip" key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}
        <button type="button" className="chip" aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Star size={16} className="inline mr-1" aria-hidden="true" />Favorites</button>
      </div>
      {matches.length === 0 && <section className="panel empty-state"><BookOpen aria-hidden="true" /><h2 className="display">{versions.length ? "No matching recipes" : "Start your recipe library"}</h2><p className="muted">{versions.length ? "Try a different filter, search or category." : "Save a recipe you make often or start a draft from your notes."}</p></section>}
      <div className="recipe-grid">{matches.map((version) => <article className="panel recipe-card" key={version.id}>
        <RecipeImage recipeId={version.recipe_id} name={version.document.name} category={version.document.category} />
        <div className="body">
          <h2><button type="button" onClick={() => show(version.id)}>{version.document.name}</button></h2>
          <div className="line"><Status>{isApproved(version) ? "Approved" : version.document.status}</Status>{store.library.favorites.includes(version.recipe_id) && <Star aria-label="Favorite" size={19} />}</div>
          <p className="muted">{version.document.yieldLow ? `Makes ${version.document.yieldLow}${version.document.yieldHigh ? `–${version.document.yieldHigh}` : ""} ${version.document.yieldUnit}` : "Yield to verify"}</p>
        </div>
      </article>)}</div>
    </div>
  </>;
}

export function RecipeDetail({ store, version, show, edit, back, bake }: {
  store: WorkspaceStore; version: Version; show: (id: string) => void; edit: () => void; back: () => void; bake: () => void;
}) {
  const recipe = version.document;
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const approved = store.library.approvals[version.recipe_id];
  const isFavorite = store.library.favorites.includes(version.recipe_id);
  const userPolicies = recordsOf(store.records, "policy");
  const policies = userPolicies.length ? userPolicies.map((row) => row.document) : defaultPolicies.map(([title, pattern]) => ({ title, pattern, enabled: true }));
  const quantity = Number(target) > 0 ? Number(target) : null;
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); } catch (cause) { setError(message(cause)); }
  };
  return <div className="stack">
    <div className="actions"><Button tone="ghost" onClick={back}>All recipes</Button></div>
    <Heading title={recipe.name} detail={recipe.category}>
      <Button onClick={bake} disabled={!canBake(recipe) || !["Ready for Testing", "Tested"].includes(recipe.status)}>Start baking</Button>
    </Heading>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions">
      <Status>{recipe.status}</Status>{approved === version.id && <Status>Preferred</Status>}
      <Button tone="secondary" onClick={edit}>New revision</Button>
      <Button tone="ghost" onClick={() => void run(() => store.favorite(version.recipe_id))}>{isFavorite ? "Remove favorite" : "Favorite"}</Button>
      {["Tested", "Ready for Testing"].includes(recipe.status) && canBake(recipe) && approved !== version.id && <Button tone="secondary" onClick={() => setConfirmation(true)}>Make preferred version</Button>}
    </div>
    {confirmation && <section className="panel stack"><p>{recipe.status === "Tested" ? "Use this tested version as the preferred recipe?" : "This version has not been tested yet. Use it as the preferred recipe for the next test bake?"}</p><div className="actions">
      <Button onClick={() => void run(async () => { await store.approve(version); setConfirmation(false); })}>Make preferred</Button>
      <Button tone="ghost" onClick={() => setConfirmation(false)}>Cancel</Button>
    </div></section>}
    <RecipePhotoSection recipeId={version.recipe_id} name={recipe.name} />
    {recipe.description && <p>{recipe.description}</p>}
    {recipe.source && <p className="muted">Source · {recipe.source}</p>}
    {recipe.tags.length > 0 && <p className="muted">{recipe.tags.join(" · ")}</p>}
    <div className="cols">
      <section className="panel stack"><h2>Ingredients</h2>
        {recipe.yieldLow && <Field label={`Target ${recipe.yieldUnit}`}><input type="number" min="0.01" step="any" placeholder={String(recipe.yieldLow)} value={target} onChange={(event) => setTarget(event.target.value)} /></Field>}
        {quantity && recipe.steps.some((step) => step.kind === "Oven") && <p className="warning">Review pan size, mixing capacity and baking time before changing the batch size.</p>}
        {!recipe.ingredients.length && <p className="muted">Add verified ingredients in a revision.</p>}
        {recipe.ingredients.map((ingredient) => {
          const result = scale(ingredient, recipe, quantity);
          const alerts = policies.filter((policy) => policy.enabled && !recipe.exceptions.includes(policy.title) &&
            split(policy.pattern).some((pattern) => ingredient.name.toLowerCase().includes(pattern.toLowerCase())));
          return <div className="row stack compact" key={ingredient.id}><strong>{formatAmount(result)} · {ingredient.name}</strong>
            {ingredient.preparation && <p>{ingredient.preparation}</p>}
            {[result.warning, ...alerts.map((policy) => policy.title)].filter(Boolean).map((text) => <p key={text} className="warning">{text}</p>)}
          </div>;
        })}
      </section>
      <section className="panel stack"><h2>Method</h2>
        <ol className="stack">{recipe.steps.map((step, index) => <li key={step.id} className="row stack compact">
          <strong>Step {index + 1} · {step.kind}{step.temperature ? ` · ${step.temperature} °F` : ""}{step.minutes ? ` · ${step.minutes} min` : ""}</strong>
          <p className="whitespace-pre-wrap">{step.instruction}</p>
          {recipe.ingredients.filter((ingredient) => step.ingredients.includes(ingredient.id)).map((ingredient) =>
            <p className="muted" key={ingredient.id}>{formatAmount(scale(ingredient, recipe, quantity))} {ingredient.name}</p>)}
        </li>)}</ol>
        {!recipe.steps.length && <p className="muted">Add verified instructions in a revision.</p>}
        {recipe.equipment.length > 0 && <p>Equipment · {recipe.equipment.join(", ")}</p>}
        {recipe.storage && <p>Storage · {recipe.storage}</p>}
        {recipe.freezer && <p>Freezer · {recipe.freezer}</p>}
        {recipe.notes && <p>Notes · {recipe.notes}</p>}
      </section>
    </div>
    <section className="panel"><h2>Version history</h2>
      {store.library.versions.filter((item) => item.recipe_id === version.recipe_id).map((item) => <div className="row line" key={item.id}>
        <div><strong>{item.id === approved ? `Preferred · ${item.document.status}` : item.document.status}</strong> · {new Date(item.created_at).toLocaleDateString("en-US")}
          {item.document.changeReason && <p>{item.document.changeReason}</p>}</div>
        <Button tone="ghost" disabled={item.id === version.id} onClick={() => show(item.id)}>{item.id === version.id ? "Current view" : "View version"}</Button>
      </div>)}
    </section>
  </div>;
}

export function RecipeEditor({ store, version, initialName, complete, cancel }: {
  store: WorkspaceStore; version?: Version; initialName?: string; complete: (id: string) => void; cancel: () => void;
}) {
  const [recipe, setRecipe] = useState<Recipe>(() => version ? { ...version.document, status: "Draft", changeReason: "" } : blankRecipe(initialName));
  const [paste, setPaste] = useState("");
  const [website, setWebsite] = useState("");
  const [progress, setProgress] = useState("");
  const [imported, setImported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (value: Partial<Recipe>) => setRecipe((previous) => ({ ...previous, ...value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    void store.addRecipe(recipe, version?.recipe_id).then((saved) => complete(saved.id)).catch((cause) => {
      setError(message(cause));
      setBusy(false);
    });
  }
  async function importFile(file: File | undefined) {
    if (!file || importing) return;
    setError("");
    setImporting(true);
    setProgress("Reading source file…");
    try {
      setPaste(await readRecipeFile(file, setProgress));
      if (!recipe.source) patch({ source: file.name });
    } catch (cause) { setError(message(cause)); }
    finally { setImporting(false); setProgress(""); }
  }
  return <><Heading title={version ? "New recipe revision" : "New recipe"} />
    <form className="stack" onSubmit={submit}>
      <section className="panel stack">
        <div className="cols">
          <Field label="Recipe name"><input required value={recipe.name} onChange={(event) => patch({ name: event.target.value })} /></Field>
          <Field label="Category"><input list="recipe-categories" required value={recipe.category} onChange={(event) => patch({ category: event.target.value })} /></Field>
          <datalist id="recipe-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          <Field label="Original yield"><input type="number" min="0.01" step="any" value={recipe.yieldLow ?? ""} onChange={(event) => patch({ yieldLow: number(event.target.value) ?? null })} /></Field>
          <Field label="Maximum yield (optional)"><input type="number" min="0.01" step="any" value={recipe.yieldHigh ?? ""} onChange={(event) => patch({ yieldHigh: number(event.target.value) })} /></Field>
          <Field label="Yield unit"><input required value={recipe.yieldUnit} onChange={(event) => patch({ yieldUnit: event.target.value })} /></Field>
          <Field label="Status"><select value={recipe.status} onChange={(event) => patch({ status: event.target.value as Recipe["status"] })}>{recipeStatuses.map((name) => <option key={name}>{name}</option>)}</select></Field>
        </div>
        <Field label="Description"><textarea value={recipe.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
        <Field label="Source or attribution"><input value={recipe.source} onChange={(event) => patch({ source: event.target.value })} /></Field>
        <details>
          <summary>Import source text</summary>
          <div className="stack">
            <Field label="Paste recipe or transcript"><textarea value={paste} onChange={(event) => setPaste(event.target.value)} /></Field>
            <Field label="Upload a document or screenshot"><input type="file" accept={sourceFileTypes} disabled={importing} onChange={(event) => void importFile(event.target.files?.[0])} /></Field>
            {progress && <p role="status">{progress}</p>}
            <div className="actions">
              <Button tone="secondary" disabled={!paste.trim() || importing} onClick={() => {
                setError("");
                const found = parseRecipeImport(paste, recipe.source);
                if (found) { setRecipe(found); setImported(true); }
                else patch({ notes: [recipe.notes, paste.trim().slice(0, 14000)].filter(Boolean).join("\n\n").slice(0, 15000), status: "Draft" });
                setPaste("");
              }}>Review pasted source</Button>
            </div>
            <Field label="Recipe website link"><input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} /></Field>
            <Button tone="secondary" disabled={!website.trim() || importing} onClick={async () => {
              setError(""); setImporting(true);
              try { setRecipe(await store.importWebsite(website)); setImported(true); }
              catch (cause) { setError(message(cause)); }
              finally { setImporting(false); }
            }}>{importing ? "Reading website…" : "Review website recipe"}</Button>
            <p className="muted">Review the source and enter verified measurements and instructions below. Check measurements from screenshots carefully. For videos, paste a transcript.</p>
          </div>
        </details>
      </section>
      {imported && <p className="notice warning" role="status">Imported as a draft. Review ingredient quantities, oven steps, times and ingredient assignments before baking.</p>}
      <section className="panel stack"><div className="line"><h2>Ingredients</h2><Button tone="secondary" onClick={() => patch({ ingredients: [...recipe.ingredients, { id: crypto.randomUUID(), name: "", quantity: null, unit: "", preparation: "" }] })}>Add ingredient</Button></div>
        {recipe.ingredients.map((item, index) => {
          const change = (value: Partial<typeof item>) => patch({ ingredients: recipe.ingredients.map((ingredient) => ingredient.id === item.id ? { ...ingredient, ...value } : ingredient) });
          return <fieldset className="row stack" key={item.id}><legend>Ingredient {index + 1}</legend><div className="cols">
            <Field label="Ingredient name"><input required value={item.name} onChange={(event) => change({ name: event.target.value })} /></Field>
            <Field label="Quantity"><input type="number" min="0.00001" step="any" value={item.quantity ?? ""} onChange={(event) => change({ quantity: number(event.target.value) ?? null })} /></Field>
            <Field label="Unit"><input value={item.unit} onChange={(event) => change({ unit: event.target.value })} placeholder="g, tsp, whole" /></Field>
            <Field label="Verified grams per unit"><input type="number" min="0.00001" step="any" value={item.gramsPerUnit ?? ""} onChange={(event) => change({ gramsPerUnit: number(event.target.value) })} /></Field>
            <Field label="Preparation"><input value={item.preparation} onChange={(event) => change({ preparation: event.target.value })} /></Field>
          </div><Button tone="ghost" onClick={() => patch({ ingredients: recipe.ingredients.filter((ingredient) => ingredient.id !== item.id), steps: recipe.steps.map((step) => ({ ...step, ingredients: step.ingredients.filter((id) => id !== item.id) })) })}>Remove ingredient</Button></fieldset>;
        })}
      </section>
      <section className="panel stack"><div className="line"><h2>Instructions</h2><Button tone="secondary" onClick={() => patch({ steps: [...recipe.steps, { id: crypto.randomUUID(), instruction: "", ingredients: [], kind: "Work" }] })}>Add step</Button></div>
        {recipe.steps.map((step, index) => {
          const change = (value: Partial<typeof step>) => patch({ steps: recipe.steps.map((item) => item.id === step.id ? { ...item, ...value } : item) });
          return <fieldset className="row stack" key={step.id}><legend>Step {index + 1}</legend>
            <Field label="Instruction"><textarea required value={step.instruction} onChange={(event) => change({ instruction: event.target.value })} /></Field>
            <div className="cols">
              <Field label="Step type"><select value={step.kind} onChange={(event) => change({ kind: event.target.value as typeof step.kind })}>{["Work", "Rest", "Oven", "Cool"].map((name) => <option key={name}>{name}</option>)}</select></Field>
              <Field label="Minutes"><input type="number" min="0.01" step="any" value={step.minutes ?? ""} onChange={(event) => change({ minutes: number(event.target.value) })} /></Field>
              {step.kind === "Oven" && <Field label="Oven temperature (°F)"><input type="number" min="75" max="650" value={step.temperature ?? ""} onChange={(event) => change({ temperature: number(event.target.value) })} /></Field>}
            </div>
            {recipe.ingredients.length > 0 && <details><summary>Ingredients for this step · {step.ingredients.length}</summary>
              {recipe.ingredients.map((ingredient) => <label className="check" key={ingredient.id}><input type="checkbox" checked={step.ingredients.includes(ingredient.id)}
                onChange={(event) => change({ ingredients: event.target.checked ? [...step.ingredients, ingredient.id] : step.ingredients.filter((id) => id !== ingredient.id) })} /><span>{ingredient.name || "Unnamed ingredient"}</span></label>)}
            </details>}
            <Button tone="ghost" onClick={() => patch({ steps: recipe.steps.filter((item) => item.id !== step.id) })}>Remove step</Button>
          </fieldset>;
        })}
      </section>
      <section className="panel"><details open={Boolean(version)}><summary>Preparation, storage and notes</summary><div className="stack">
        {(["tags", "equipment", "shots", "exceptions"] as const).map((key, index) => <Field key={key} label={["Tags (comma-separated)", "Equipment, pans and trays (comma-separated)", "Custom shots (comma-separated)", "Approved policy exceptions (exact names, comma-separated)"][index]}>
          <input defaultValue={recipe[key].join(", ")} onChange={(event) => patch({ [key]: split(event.target.value) })} />
        </Field>)}
        {recipe.prep.map((item, index) => <div className="cols" key={index}>
          <Field label={`Preparation task ${index + 1}`}><input required value={item.title} onChange={(event) => patch({ prep: recipe.prep.map((task, i) => i === index ? { ...task, title: event.target.value } : task) })} /></Field>
          <Field label="Days before bake"><input type="number" min="0" max="30" value={item.daysBefore} onChange={(event) => patch({ prep: recipe.prep.map((task, i) => i === index ? { ...task, daysBefore: Number(event.target.value) } : task) })} /></Field>
          <Button tone="ghost" onClick={() => patch({ prep: recipe.prep.filter((_, i) => i !== index) })}>Remove preparation task</Button>
        </div>)}
        <Button tone="secondary" onClick={() => patch({ prep: [...recipe.prep, { title: "", daysBefore: 1 }] })}>Add preparation task</Button>
        {(["storage", "freezer", "notes", "changeReason"] as const).map((key, index) => <Field key={key} label={["Storage instructions", "Freezer instructions", "Personal notes", "Reason for revision"][index]}>
          <textarea value={recipe[key]} onChange={(event) => patch({ [key]: event.target.value })} />
        </Field>)}
      </div></details></section>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><Button type="submit" disabled={busy || importing}>{busy ? "Saving…" : "Save recipe"}</Button><Button tone="ghost" onClick={cancel}>Cancel</Button></div>
    </form>
  </>;
}
