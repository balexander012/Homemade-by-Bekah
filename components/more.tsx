"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { imageAccept, uploadPhoto } from "@/lib/images";
import { Photo } from "./photos";
import { categories, ideaStatuses, type Doc, type Entry } from "@/lib/domain";
import { defaultPolicies } from "@/lib/sample";
import { recordsOf } from "@/lib/store";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, Status, message } from "./ui";

export type Theme = "system" | "light" | "dark";
const emptyIdea: Doc<"idea"> = { name: "", description: "", category: "Cookies", link: "", notes: "", priority: "Normal", status: "Idea" };

export function More({ store, theme, setTheme, signOut, demo, createRecipe, schedule, resume, client, workspace, alerts, alertMessage, toggleAlerts }: {
  store: WorkspaceStore; client: SupabaseClient | null; workspace: string; theme: Theme; setTheme: (theme: Theme) => void; signOut: () => void; demo: boolean;
  alerts: boolean; alertMessage: string; toggleAlerts: () => void;
  createRecipe: (name: string) => void; schedule: (name: string, date?: string) => void; resume: (id: string) => void;
}) {
  const [editor, setEditor] = useState<{ id?: string; document: Doc<"idea"> }>();
  const [image, setImage] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const policies = recordsOf(store.records, "policy");
  const ideas = recordsOf(store.records, "idea").sort((left, right) => left.document.name.localeCompare(right.document.name));
  const completed = recordsOf(store.records, "session").filter((session) => session.document.status === "Completed");
  const save = (original?: Entry<"idea">) => {
    setEditor(original ? { id: original.id, document: original.document } : { document: emptyIdea });
    setError("");
    setImage(undefined);
  };
  const patch = (partial: Partial<Doc<"idea">>) => { if (editor) setEditor({ ...editor, document: { ...editor.document, ...partial } }); };
  return <><Heading title="More" /><div className="stack">
    <section className="panel stack"><div className="line"><h2>Recipe ideas</h2><Button onClick={() => save()}>Add idea</Button></div>
      {editor && <form className="row stack" onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try {
          const id = editor.id ?? crypto.randomUUID();
          const path = image && client ? await uploadPhoto(client, `${workspace}/ideas/${id}`, image, crypto.randomUUID()) : editor.document.image;
          store.put("idea", { ...editor.document, image: path }, id);
          setEditor(undefined);
        } catch (cause) { setError(message(cause)); }
        finally { setBusy(false); }
      }}>
        <div className="cols">
          <Field label="Idea name"><input required value={editor.document.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
          <Field label="Category"><input required list="idea-categories" value={editor.document.category} onChange={(e) => patch({ category: e.target.value })} /></Field>
          <datalist id="idea-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          <Field label="Inspiration link"><input type="url" value={editor.document.link} onChange={(e) => patch({ link: e.target.value })} /></Field>
          <Field label="Target baking date"><input type="date" value={editor.document.target ?? ""} onChange={(e) => patch({ target: e.target.value || undefined })} /></Field>
          <Field label="Priority"><select value={editor.document.priority} onChange={(e) => patch({ priority: e.target.value as typeof emptyIdea.priority })}>
            {["Low", "Normal", "High"].map((name) => <option key={name}>{name}</option>)}</select></Field>
          <Field label="Idea status"><select value={editor.document.status} onChange={(e) => patch({ status: e.target.value as typeof emptyIdea.status })}>
            {ideaStatuses.map((name) => <option key={name}>{name}</option>)}</select></Field>
        </div>
        <Field label="Description"><textarea value={editor.document.description} onChange={(e) => patch({ description: e.target.value })} /></Field>
        <Field label="Notes"><textarea value={editor.document.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
        {client && <Field label="Inspiration image"><input type="file" accept={imageAccept} onChange={(e) => setImage(e.target.files?.[0])} /></Field>}
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="actions"><Button type="submit" disabled={busy || Boolean(image && !store.online)}>Save idea</Button><Button tone="ghost" onClick={() => setEditor(undefined)}>Cancel</Button></div>
      </form>}
      {!ideas.length && <p className="muted">Save products you want to try, even before you have a recipe.</p>}
      {ideas.map((idea) => <details className="row" key={idea.id}><summary>{idea.document.name} · {idea.document.status}</summary><div className="stack">
        {idea.document.description && <p>{idea.document.description}</p>}{idea.document.notes && <p>{idea.document.notes}</p>}
        {client && idea.document.image && <div className="max-w-sm"><Photo client={client} alt={idea.document.name} path={idea.document.image} /></div>}
        {idea.document.link && <a href={idea.document.link} target="_blank" rel="noreferrer">Open inspiration</a>}
        <div className="actions"><Button tone="secondary" onClick={() => createRecipe(idea.document.name)}>Create recipe draft</Button>
          <Button tone="secondary" onClick={() => schedule(idea.document.name, idea.document.target)}>Plan a bake</Button>
          <Button tone="ghost" onClick={() => save(idea)}>Edit idea</Button></div>
      </div></details>)}
    </section>
    <section className="panel"><details><summary>Completed sessions · {completed.length}</summary>
      {completed.map((session) => <div className="row line" key={session.id}><p>{session.document.title} · {session.document.date}</p>
        <Button tone="secondary" onClick={() => resume(session.id)}>View session</Button></div>)}
      {!completed.length && <p className="muted">Completed sessions appear here.</p>}
    </details></section>
    <section className="panel"><details><summary>Ingredient standards</summary><div className="stack">
      <p>Flags prompt a label check. Recipe exceptions are recorded in the recipe revision.</p>
      {policies.length === 0 && <><ul className="stack compact">{defaultPolicies.map(([title]) => <li key={title}>{title}</li>)}</ul>
        <Button tone="secondary" onClick={() => defaultPolicies.forEach(([title, pattern]) => store.put("policy", { title, pattern, enabled: true }))}>Customize standards</Button></>}
      {policies.map((entry) => <div key={entry.id} className="row"><label className="check"><input type="checkbox" checked={entry.document.enabled}
        onChange={(e) => store.put("policy", { ...entry.document, enabled: e.target.checked }, entry.id)} /><span>{entry.document.title}</span></label>
        <Field label={`Match terms for ${entry.document.title}`}><input key={entry.document.pattern} defaultValue={entry.document.pattern} minLength={2} maxLength={200}
          onBlur={(e) => { if (e.target.value.trim().length >= 2) store.put("policy", { ...entry.document, pattern: e.target.value }, entry.id); }} /></Field>
      </div>)}
    </div></details></section>
    <section className="panel stack"><h2>Settings</h2>
      <Field label="Kitchen theme"><select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="system">Match device</option><option value="light">Bakery Light</option><option value="dark">Kitchen Dark</option>
      </select></Field>
      <div className="stack compact">
        <Button tone="secondary" onClick={toggleAlerts}>{alerts ? "Turn off timer notifications" : "Enable timer notifications"}</Button>
        <p className="muted">This device can show alerts while the app is running and the browser permits notifications.</p>
        {alertMessage && <p role="status">{alertMessage}</p>}
      </div>
      {demo && <Status>Local demo</Status>}
      {!demo && (confirm ? <div className="stack">
        <p>{Object.keys(store.queue).length > 0 ? "This device has unsynced changes. Sync first to keep them, or sign out and remove the device copy." : "Signing out clears the kitchen data saved on this device."}</p>
        <div className="actions"><Button onClick={signOut}>Confirm sign out</Button><Button tone="secondary" onClick={() => void store.sync()}>Sync now</Button><Button tone="ghost" onClick={() => setConfirm(false)}>Stay signed in</Button></div>
      </div> : <Button tone="secondary" onClick={() => setConfirm(true)}>Sign out</Button>)}
    </section>
  </div></>;
}
