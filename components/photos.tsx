"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { easternDate, shotStatuses, shotsFor, type Doc, type Entry, type Version } from "@/lib/domain";
import { recordsOf } from "@/lib/store";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, Status, message } from "./ui";

const uses = ["Website", "Instagram", "Facebook", "TikTok", "Product catalog", "Packaging"] as const;
const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif" };

function Photo({ client, path, alt }: { client: SupabaseClient; path: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let photoUrl = "";
    void client.storage.from("baking-photos").download(path).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) { setFailed(true); return; }
      photoUrl = URL.createObjectURL(data);
      setUrl(photoUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [client, path]);
  if (failed) return <p className="muted">Photo preview unavailable.</p>;
  return url ? <img className="photo" src={url} alt={alt} onError={() => setFailed(true)} /> : <p className="muted">Loading photo…</p>;
}

function Feedback({ session, version, store }: { session: Entry<"session">; version: Version; store: WorkspaceStore }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState(() => session.document.feedback[version.id] ?? { notes: "", worked: "", change: "", again: "" as const });
  const patch = (changes: Partial<Doc<"session">["feedback"][string]>) => { setValue({ ...value, ...changes }); setSaved(false); };
  return <details><summary>Baking feedback</summary>
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      try { store.put("session", { ...session.document, feedback: { ...session.document.feedback, [version.id]: value } }, session.id); setSaved(true); setError(""); }
      catch (cause) { setError(message(cause)); }
    }}>
      <div className="cols"><Field label="Actual yield"><input type="number" min="0.01" step="any" value={value.yield ?? ""} onChange={(e) => patch({ yield: e.target.value ? Number(e.target.value) : undefined })} /></Field>
        {(["taste", "texture", "appearance"] as const).map((key) => <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
          <select value={value[key] ?? ""} onChange={(e) => patch({ [key]: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Skip</option>{[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>{number} / 5</option>)}
          </select></Field>)}</div>
      <Field label="Notes, including frozen dough"><textarea maxLength={15000} value={value.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
      <Field label="What worked"><textarea maxLength={15000} value={value.worked} onChange={(e) => patch({ worked: e.target.value })} /></Field>
      <Field label="What to change next time"><textarea maxLength={15000} value={value.change} onChange={(e) => patch({ change: e.target.value })} /></Field>
      <Field label="Make it again?"><select value={value.again} onChange={(e) => patch({ again: e.target.value as "" | "Yes" | "No" })}><option value="">Skip</option><option>Yes</option><option>No</option></select></Field>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><Button type="submit">Save feedback</Button>{saved && <span role="status">Feedback saved</span>}</div>
    </form>
  </details>;
}

function ProductPhotos({ client, workspace, session, version, store }: {
  client: SupabaseClient | null; workspace: string; session: Entry<"session">; version: Version; store: WorkspaceStore;
}) {
  const shots = shotsFor(version.document);
  const [shot, setShot] = useState(shots[0]);
  const [use, setUse] = useState<Doc<"photo">["use"]>("Website");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const [fileKey, setFileKey] = useState(0);
  const related = recordsOf(store.records, "photo").filter(({ document }) => document.sessionId === session.id && document.versionId === version.id);
  const check = session.document.shots[version.id] ?? {};
  async function upload() {
    if (!client || !files.length || busy) return;
    setBusy(true);
    setUploaded(0);
    setError("");
    let count = 0;
    try {
      for (const file of files) {
        const suffix = extensions[file.type];
        if (!suffix || file.size > 15728640) throw new Error("Choose JPEG, PNG, WebP, HEIC, HEIF, or AVIF images up to 15 MB each.");
      }
      for (const file of files) {
        const id = crypto.randomUUID();
        const path = `${workspace}/${session.id}/${version.id}/${id}.${extensions[file.type]}`;
        const result = await client.storage.from("baking-photos").upload(path, file, { contentType: file.type, upsert: false });
        if (result.error) throw new Error(result.error.message);
        store.put("photo", { sessionId: session.id, versionId: version.id, path, shot, captured: easternDate(), use, status: "Captured", hero: false }, id);
        count += 1;
      }
    } catch (cause) { setError(message(cause)); }
    finally {
      setUploaded(count);
      setFiles(files.slice(count));
      if (count === files.length) setFileKey((previous) => previous + 1);
      setBusy(false);
    }
  }
  return <article className="panel stack">
    <div className="line"><div className="stack compact"><p className="eyebrow">{session.document.title} · {session.document.date}</p><h2>{version.document.name}</h2></div>
      <Status>{shots.every((name) => check[name] === "Approved") ? "Shots approved" : "Ready for photos"}</Status></div>
    <div className="tiles">{shots.map((name) => <Field key={name} label={name}><select value={check[name] ?? "Not started"} onChange={(e) => {
      store.put("session", { ...session.document, shots: { ...session.document.shots, [version.id]: { ...check, [name]: e.target.value as typeof shotStatuses[number] } } }, session.id);
    }}>{shotStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field>)}</div>
    <details><summary>Framing and lighting</summary><div className="stack compact">
      <p>Use soft side light and a simple surface. Capture the full bake first, then move closer for texture.</p>
      <p>Leave room in the frame for the website crop. Use the broken-open or sliced shot to show the interior.</p>
    </div></details>
    {client ? <form className="stack" onSubmit={(e) => { e.preventDefault(); void upload(); }}>
      <div className="cols"><Field label="Shot type"><select value={shot} onChange={(e) => setShot(e.target.value)}>{shots.map((name) => <option key={name}>{name}</option>)}</select></Field>
        <Field label="Intended use"><select value={use} onChange={(e) => setUse(e.target.value as typeof use)}>{uses.map((name) => <option key={name}>{name}</option>)}</select></Field></div>
      <Field label="Choose photos"><input key={fileKey} type="file" accept={Object.keys(extensions).join(",")} multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></Field>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><Button type="submit" disabled={!store.online || busy || !files.length}>{busy ? "Uploading…" : "Upload photos"}</Button>
        {uploaded > 0 && <span role="status">{uploaded} uploaded</span>}{!store.online && <p className="muted">Reconnect to upload photos.</p>}</div>
    </form> : <p className="muted">Connect Supabase Storage to upload photos.</p>}
    {client && related.length > 0 && <div className="tiles">{related.map((entry) => <div className="row stack" key={entry.id}>
      <Photo client={client} path={entry.document.path} alt={`${version.document.name}, ${entry.document.shot}`} />
      <p>{entry.document.shot} · {entry.document.use} · {entry.document.captured}</p>
      <Field label="Photo status"><select value={entry.document.status} onChange={(e) => store.put("photo", { ...entry.document, status: e.target.value as typeof shotStatuses[number] }, entry.id)}>
        {shotStatuses.map((name) => <option key={name}>{name}</option>)}</select></Field>
      <Button tone="secondary" disabled={entry.document.hero} onClick={() => {
        for (const image of related) if (image.document.hero && image.id !== entry.id) store.put("photo", { ...image.document, hero: false }, image.id);
        store.put("photo", { ...entry.document, hero: true }, entry.id);
      }}>{entry.document.hero ? "Hero image" : "Set as hero"}</Button>
    </div>)}</div>}
    <Feedback key={version.id} session={session} version={version} store={store} />
  </article>;
}

export function Photos({ store, client, workspace }: { store: WorkspaceStore; client: SupabaseClient | null; workspace: string }) {
  const queue = recordsOf(store.records, "session").flatMap((session) => session.document.recipes.flatMap((recipe) => {
    const version = store.library.versions.find((item) => item.id === recipe.versionId);
    return version?.document.steps.length && version.document.steps.every((step) => recipe.completed.includes(step.id)) ? [{ session, version }] : [];
  }));
  return <><Heading title="Photography" detail="Ready for photos" /><section className="stack">
    {queue.length ? queue.map(({ session, version }) => <ProductPhotos key={`${session.id}:${version.id}`} {...{ store, client, workspace, session, version }} />) :
      <div className="panel stack"><Camera /><h2>No batches ready</h2><p className="muted">Finishing a batch adds its shot checklist here.</p></div>}
  </section></>;
}
