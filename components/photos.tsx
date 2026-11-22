"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeVersions, easternDate, shotStatuses, shotsFor, type Doc, type Entry, type Version } from "@/lib/domain";
import { imageAccept, uploadPhoto, validatePhoto } from "@/lib/images";
import { recordsOf } from "@/lib/store";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, Status, message } from "./ui";

const uses = ["Website", "Instagram", "Facebook", "TikTok", "Product catalog", "Packaging"] as const;
export function Photo({ client, path, alt }: { client: SupabaseClient; path: string; alt: string }) {
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
      files.forEach(validatePhoto);
      for (const file of files) {
        const id = crypto.randomUUID();
        const path = await uploadPhoto(client, `${workspace}/${session.id}/${version.id}`, file, id);
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
    <h3>Shot list</h3>
    <div className="shot-grid">{shots.map((name) => {
      const count = related.filter((item) => item.document.shot === name).length;
      return <div className="shot-tile" data-status={check[name] ?? "Not started"} key={name}><Field label={name}><select value={check[name] ?? "Not started"} onChange={(e) => {
        store.put("session", { ...session.document, shots: { ...session.document.shots, [version.id]: { ...check, [name]: e.target.value as typeof shotStatuses[number] } } }, session.id);
      }}>{shotStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 15 }}>{count ? `${count} photo${count === 1 ? "" : "s"}` : "No photos yet"}</p></div>;
    })}</div>
    <details><summary>Framing and lighting</summary><div className="stack compact">
      <p>Use soft side light and a simple surface. Capture the full bake first, then move closer for texture.</p>
      <p>Leave room in the frame for the website crop. Use the broken-open or sliced shot to show the interior.</p>
    </div></details>
    {client && recordsOf(store.records, "reference").some(({ document }) => document.versionId === version.id) && <details>
      <summary>Recipe photo references</summary>
      <div className="tiles">{recordsOf(store.records, "reference").filter(({ document }) => document.versionId === version.id).map((item) =>
        <div className="stack compact" key={item.id}><Photo client={client} path={item.document.path} alt={item.document.title} /><p>{item.document.notes}</p></div>)}</div>
    </details>}
    {client ? <form className="stack" onSubmit={(e) => { e.preventDefault(); void upload(); }}>
      <div className="cols"><Field label="Shot type"><select value={shot} onChange={(e) => setShot(e.target.value)}>{shots.map((name) => <option key={name}>{name}</option>)}</select></Field>
        <Field label="Intended use"><select value={use} onChange={(e) => setUse(e.target.value as typeof use)}>{uses.map((name) => <option key={name}>{name}</option>)}</select></Field></div>
      <label className="file-pick"><input key={fileKey} type="file" accept={imageAccept} multiple aria-label="Choose photos" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <span className="hb-btn hb-btn--app hb-btn--secondary" aria-hidden="true"><Camera size={22} /> Add photos</span>
        <span className="muted">{files.length ? `${files.length} selected` : "From the camera or photo library"}</span></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><Button type="submit" disabled={!store.online || busy || !files.length}>{busy ? "Uploading…" : "Upload photos"}</Button>
        {uploaded > 0 && <span role="status">{uploaded} uploaded</span>}{!store.online && <p className="muted">Reconnect to upload photos.</p>}</div>
    </form> : <p className="muted">Connect Supabase Storage to upload photos.</p>}
    {client && related.length > 0 && <div className="tiles">{related.map((entry) => <div className="row stack" key={entry.id}>
      <Photo client={client} path={entry.document.path} alt={`${version.document.name}, ${entry.document.shot}`} />
      <p>{entry.document.shot} · {entry.document.use} · {entry.document.captured}</p>
      <Field label="Photo status"><select value={entry.document.status} onChange={(e) => store.put("photo", { ...entry.document, status: e.target.value as typeof shotStatuses[number] }, entry.id)}>
        {shotStatuses.map((name) => <option key={name}>{name}</option>)}</select></Field>
      <Button tone="secondary" disabled={(session.document.heroPhotos?.[version.id] ?? related.find((item) => item.document.hero)?.id) === entry.id} onClick={() =>
        store.put("session", { ...session.document, heroPhotos: { ...session.document.heroPhotos, [version.id]: entry.id } }, session.id)}>
        {(session.document.heroPhotos?.[version.id] ?? related.find((item) => item.document.hero)?.id) === entry.id ? "Hero image" : "Set as hero"}
      </Button>
    </div>)}</div>}
    <Feedback key={version.id} session={session} version={version} store={store} />
  </article>;
}

function References({ store, client, workspace }: { store: WorkspaceStore; client: SupabaseClient; workspace: string }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File>();
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const references = recordsOf(store.records, "reference");
  return <section className="panel"><details><summary>Photo references · {references.length}</summary><div className="stack">
    <form className="stack" onSubmit={async (event) => {
      event.preventDefault();
      if (!file || busy) return;
      setBusy(true); setError("");
      try {
        const id = crypto.randomUUID();
        const path = await uploadPhoto(client, `${workspace}/references`, file, id);
        store.put("reference", { title, notes, path, versionId: version || undefined }, id);
        setTitle(""); setNotes(""); setVersion(""); setFile(undefined); setFileKey((value) => value + 1);
      } catch (cause) { setError(message(cause)); }
      finally { setBusy(false); }
    }}>
      <div className="cols">
        <Field label="Reference title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Recipe (optional)"><select value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="">General reference</option>{activeVersions(store.library).map((item) => <option value={item.id} key={item.id}>{item.document.name}</option>)}
        </select></Field>
      </div>
      <Field label="Framing, lighting, or source notes"><textarea maxLength={15000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Reference image"><input type="file" key={fileKey} accept={imageAccept} onChange={(e) => setFile(e.target.files?.[0])} /></Field>
      {error && <p role="alert" className="notice error">{error}</p>}
      <Button type="submit" disabled={!file || !store.online || busy}>{busy ? "Uploading…" : "Save photo reference"}</Button>
    </form>
    <div className="tiles">{references.map((item) => <article className="row stack compact" key={item.id}>
      <Photo client={client} path={item.document.path} alt={item.document.title} />
      <h3>{item.document.title}</h3>{item.document.notes && <p>{item.document.notes}</p>}
    </article>)}</div>
  </div></details></section>;
}

export function Photos({ store, client, workspace }: { store: WorkspaceStore; client: SupabaseClient | null; workspace: string }) {
  const queue = recordsOf(store.records, "session").flatMap((session) => session.document.recipes.flatMap((recipe) => {
    const version = store.library.versions.find((item) => item.id === recipe.versionId);
    return version?.document.steps.length && version.document.steps.every((step) => recipe.completed.includes(step.id)) ? [{ session, version }] : [];
  }));
  return <><Heading title="Photography" detail="Ready for photos" /><section className="stack">
    {queue.length ? queue.map(({ session, version }) => <ProductPhotos key={`${session.id}:${version.id}`} {...{ store, client, workspace, session, version }} />) :
      <div className="panel stack"><Camera /><h2>No batches ready</h2><p className="muted">Finishing a batch adds its shot checklist here.</p></div>}
    {client && <References {...{ store, client, workspace }} />}
  </section></>;
}
