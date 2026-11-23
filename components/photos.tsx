"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeVersions, easternDate, isLaunchCheckSession, shotStatuses, shotsFor, type Doc, type Entry, type Version } from "@/lib/domain";
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
    setFailed(false);
    setUrl("");
    void client.storage.from("baking-photos").download(path).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) { setFailed(true); return; }
      photoUrl = URL.createObjectURL(data);
      setUrl(photoUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (photoUrl) URL.revokeObjectURL(photoUrl); };
  }, [client, path]);
  if (failed) return <span className="muted photos-image-status">Photo preview unavailable.</span>;
  return url ? <img className="photo" src={url} alt={alt} onError={() => setFailed(true)} /> : <span className="muted photos-image-status">Loading photo…</span>;
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
  const [preview, setPreview] = useState<string>();
  const related = recordsOf(store.records, "photo").filter(({ document }) =>
    document.sessionId === session.id && document.versionId === version.id);
  const check = session.document.shots[version.id] ?? {};
  const selectedStatus = check[shot] ?? "Not started";
  const approved = shots.filter((name) => check[name] === "Approved").length;
  const selectedHero = session.document.heroPhotos?.[version.id] ?? related.find((item) => item.document.hero)?.id;
  const changeShotStatus = (name: string, status: typeof shotStatuses[number]) => {
    store.put("session", { ...session.document,
      shots: { ...session.document.shots, [version.id]: { ...check, [name]: status } },
    }, session.id);
  };
  async function upload() {
    if (!client || !files.length || busy || !store.online) return;
    setBusy(true);
    setUploaded(0);
    setError("");
    let count = 0;
    try {
      files.forEach(validatePhoto);
      for (const file of files) {
        const id = crypto.randomUUID();
        const path = await uploadPhoto(client, workspace + "/" + session.id + "/" + version.id, file, id);
        store.put("photo", { sessionId: session.id, versionId: version.id, path, shot,
          captured: easternDate(), use, status: "Captured", hero: false }, id);
        count += 1;
      }
      if (count && (check[shot] === undefined || check[shot] === "Not started")) {
        changeShotStatus(shot, "Captured");
      }
    } catch (cause) { setError(message(cause)); }
    finally {
      setUploaded(count);
      setFiles(files.slice(count));
      if (count === files.length) setFileKey((previous) => previous + 1);
      setBusy(false);
    }
  }
  return <article className="photos-workspace panel stack">
    <header className="photos-workspace-heading">
      <div className="stack compact">
        <p className="eyebrow">{session.document.date} · {session.document.title}</p>
        <h2>{version.document.name}</h2>
        <p className="muted photos-workspace-progress">{approved} of {shots.length} shots approved · {related.length} saved photo{related.length === 1 ? "" : "s"}</p>
      </div>
      <Status>{approved === shots.length ? "Approved" : "Ready for photos"}</Status>
    </header>
    <section className="stack compact" aria-label="Photography shot list">
      <div className="photos-section-heading"><h3>Shot list</h3><p className="muted">Select a shot to upload or update its status.</p></div>
      <div className="photos-shot-list">{shots.map((name) => {
        const count = related.filter((item) => item.document.shot === name).length;
        const status = check[name] ?? "Not started";
        return <button type="button" key={name} className="photos-shot-option" aria-pressed={shot === name}
          onClick={() => { setShot(name); setUploaded(0); }} data-status={status}>
          <span className="photos-shot-dot" aria-hidden="true" />
          <span className="photos-shot-name">{name}</span>
          <span className="photos-shot-meta">{count ? count + " photo" + (count === 1 ? "" : "s") : status}</span>
        </button>;
      })}</div>
    </section>
    <section className="photos-upload-panel stack compact" aria-label="Add baking photos">
      <div className="photos-section-heading"><h3>Add photos</h3><p className="muted">Save photos to the selected shot.</p></div>
      <form className="stack compact" onSubmit={(e) => { e.preventDefault(); void upload(); }}>
        <div className="photos-upload-fields">
          <Field label="Shot type"><select value={shot} onChange={(e) => setShot(e.target.value)}>
            {shots.map((name) => <option key={name}>{name}</option>)}</select></Field>
          <Field label={shot + " status"}><select value={selectedStatus} onChange={(e) =>
            changeShotStatus(shot, e.target.value as typeof shotStatuses[number])}>
            {shotStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field>
          <Field label="Intended use"><select value={use} onChange={(e) => setUse(e.target.value as typeof use)}>
            {uses.map((name) => <option key={name}>{name}</option>)}</select></Field>
        </div>
        {client ? <div className="photos-upload-actions">
          <label className="photos-file-picker"><input key={fileKey} type="file" accept={imageAccept} multiple aria-label="Choose photos"
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setUploaded(0); }} />
            <span className="hb-btn hb-btn--app hb-btn--secondary" aria-hidden="true"><Camera size={17} /> Choose photos</span></label>
          <span className="photos-file-status muted">{files.length ? files.length + (files.length === 1 ? " photo selected" : " photos selected") : "Camera or photo library"}</span>
          <Button type="submit" disabled={!store.online || busy || !files.length}>{busy ? "Uploading…" : "Upload" + (files.length ? " " + files.length : "")}</Button>
          {uploaded > 0 && <span role="status">{uploaded} uploaded</span>}
        </div> : <p className="muted">Connect Supabase Storage to upload photos.</p>}
        {!store.online && <p className="muted">Reconnect to upload photos.</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
      </form>
    </section>
    <section className="stack compact">
      <div className="photos-section-heading"><h3>Saved photos</h3><span className="muted">{related.length} total</span></div>
      {client && related.length ? <div className="photos-gallery">
        {related.map((entry) => <article className="photos-gallery-card" key={entry.id}>
          <button className="photos-gallery-preview" type="button" aria-label={"View " + entry.document.shot + " photo"}
            onClick={() => setPreview(entry.document.path)}>
            <Photo client={client} path={entry.document.path} alt={version.document.name + ", " + entry.document.shot} />
            {selectedHero === entry.id && <span className="photos-gallery-hero">Hero</span>}
          </button>
          <div className="photos-gallery-details">
            <strong>{entry.document.shot}</strong><small className="muted">{entry.document.use}</small>
            <Field label="Photo status"><select value={entry.document.status} onChange={(e) =>
              store.put("photo", { ...entry.document, status: e.target.value as typeof shotStatuses[number] }, entry.id)}>
              {shotStatuses.map((name) => <option key={name}>{name}</option>)}</select></Field>
            <Button tone="ghost" disabled={selectedHero === entry.id} onClick={() =>
              store.put("session", { ...session.document, heroPhotos: { ...session.document.heroPhotos, [version.id]: entry.id } }, session.id)}>
              {selectedHero === entry.id ? "Hero photo" : "Set as hero"}</Button>
          </div>
        </article>)}
      </div> : <p className="photos-empty muted">No photos saved for this batch.</p>}
    </section>
    <div className="photos-more">
      <details><summary>Framing and lighting tips</summary>
        <div className="stack compact"><p>Use soft side light and a simple background. Take one full-product shot before moving in for texture.</p>
          <p>Leave space for a website crop and capture the inside of sliced or broken-open baked goods.</p></div>
      </details>
      {client && recordsOf(store.records, "reference").some(({ document }) => document.versionId === version.id) &&
        <details><summary>Photo references</summary>
          <div className="photos-gallery">{recordsOf(store.records, "reference").filter(({ document }) => document.versionId === version.id).map((item) =>
            <article className="photos-gallery-card" key={item.id}>
              <Photo client={client} path={item.document.path} alt={item.document.title} />
              <strong>{item.document.title}</strong>{item.document.notes && <p>{item.document.notes}</p>}
            </article>)}</div>
        </details>}
      <Feedback key={version.id} session={session} version={version} store={store} />
    </div>
    {client && preview && <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo preview"
      onClick={() => setPreview(undefined)}>
      <button type="button" className="photos-preview-close" onClick={() => setPreview(undefined)}>Close preview</button>
      <div className="photos-preview-media" onClick={(e) => e.stopPropagation()}>
        <Photo client={client} path={preview} alt="Selected baking photo" /></div>
    </div>}
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
  const [selected, setSelected] = useState<string | null>(null);
  const queue = recordsOf(store.records, "session")
    .filter((session) => !isLaunchCheckSession(session.document.title) && !session.document.cleared)
    .flatMap((session) => session.document.recipes.flatMap((recipe) => {
      const version = store.library.versions.find((item) => item.id === recipe.versionId);
      return version?.document.steps.length && version.document.steps.every((step) => recipe.completed.includes(step.id))
        ? [{ session, version }] : [];
    }))
    .sort((a, b) => b.session.document.date.localeCompare(a.session.document.date));
  const keyOf = ({ session, version }: (typeof queue)[number]) => session.id + ":" + version.id;
  const active = queue.find((item) => keyOf(item) === selected) ?? queue[0];
  return <div className="photos-page">
    <Heading title="Photos" detail="Product photography"/>
    <p className="muted photos-page-intro">Manage finished-batch photos, choose hero shots, and record baking feedback.</p>
    {queue.length ? <div className="photos-layout">
      <aside className="photos-batch-nav" aria-label="Baking batches ready for photos">
        <div className="photos-batch-nav-heading"><h2>Ready for photos</h2><span className="muted">{queue.length}</span></div>
        <div className="photos-batch-items">{queue.map((item) => {
          const count = recordsOf(store.records, "photo").filter(({ document }) =>
            document.sessionId === item.session.id && document.versionId === item.version.id).length;
          return <button key={keyOf(item)} type="button" aria-pressed={Boolean(active && keyOf(active) === keyOf(item))}
            className="photos-batch-option" onClick={() => setSelected(keyOf(item))}>
            <strong>{item.version.document.name}</strong>
            <small>{item.session.document.date} · {count} saved photo{count === 1 ? "" : "s"}</small>
          </button>;
        })}</div>
      </aside>
      <div className="photos-detail">{active && <ProductPhotos key={keyOf(active)} client={client} workspace={workspace}
        session={active.session} version={active.version} store={store} />}</div>
    </div> : <section className="panel photos-no-batches"><Camera size={24}/><h2>No batches ready for photos</h2>
      <p className="muted">Completed baking steps appear here when a real batch is ready to photograph.</p></section>}
    {client && <References {...{ store, client, workspace }} />}
  </div>;
}
