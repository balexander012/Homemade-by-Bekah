"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ImagePlus, RotateCw, Star, X } from "lucide-react";
import {
  decode, defaultCrop, drawCard, photoAccept, render, rotated, sha256, usePhotos,
  type Crop, type NewPhoto, type RecipePhoto, type Variant,
} from "@/lib/recipe-photos";
import { Button, Field, message } from "./ui";

export function PhotoImg({ photo, variant, alt, className }: { photo: RecipePhoto; variant: Variant; alt: string; className?: string }) {
  const store = usePhotos();
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    store?.url(photo, variant).then((value) => { if (active) setSrc(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [store, photo, variant]);
  if (failed) return <span className="photo-missing">Photo unavailable</span>;
  return src ? <img className={className} src={src} alt={alt} decoding="async" /> : <span className="photo-loading" aria-label="Loading photo" />;
}

// The recipe's main photo in a fixed 16:9 box, or the existing placeholder.
export function RecipeImage({ recipeId, name, category, variant = "thumb", size }: { recipeId: string; name: string; category?: string; variant?: Variant; size?: "small" }) {
  const store = usePhotos();
  const photo = store?.primary(recipeId);
  if (!photo) return size === "small" ? <div className="recipe-thumb small" aria-hidden="true"><BookOpen size={18} /></div> :
    <div className="recipe-thumb" aria-hidden="true"><BookOpen size={26} />{category}</div>;
  return <div className={`recipe-thumb has-photo ${size ?? ""}`}><PhotoImg photo={photo} variant={variant} alt={`${name}${photo.caption ? `: ${photo.caption}` : ""}`} /></div>;
}

type Source = ImageBitmap | HTMLImageElement;

// Crop to 16:9, rotate and drag to position. Shows exactly what the recipe card will show.
function Cropper({ source, crop, onChange }: { source: Source; crop: Crop; onChange: (crop: Crop) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const turnedRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  useEffect(() => { turnedRef.current = rotated(source, crop.rotation); }, [source, crop.rotation]);
  useEffect(() => {
    const target = ref.current;
    const turned = turnedRef.current ?? rotated(source, crop.rotation);
    turnedRef.current = turned;
    if (!target) return;
    const preview = drawCard(turned, crop, 960);
    target.width = preview.width; target.height = preview.height;
    target.getContext("2d")?.drawImage(preview, 0, 0);
  }, [source, crop]);
  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop };
  }
  function moveTo(event: ReactPointerEvent<HTMLCanvasElement>) {
    const begin = drag.current;
    const turned = turnedRef.current;
    if (!begin || !turned) return;
    const box = event.currentTarget.getBoundingClientRect();
    // Dragging the picture right shows more of its left side.
    const visibleW = 1 / begin.crop.zoom * Math.min(1, (turned.height * 16 / 9) / turned.width);
    const visibleH = 1 / begin.crop.zoom * Math.min(1, (turned.width * 9 / 16) / turned.height);
    const x = Math.min(1, Math.max(0, begin.crop.x - ((event.clientX - begin.x) / box.width) * visibleW));
    const y = Math.min(1, Math.max(0, begin.crop.y - ((event.clientY - begin.y) / box.height) * visibleH));
    onChange({ ...begin.crop, x, y });
  }
  return <div className="stack compact">
    <canvas ref={ref} className="cropper" aria-label="Photo crop preview. Drag to reposition." onPointerDown={start} onPointerMove={moveTo}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
    <div className="line">
      <Field label="Zoom"><input type="range" min="1" max="3" step="0.01" value={crop.zoom} onChange={(e) => onChange({ ...crop, zoom: Number(e.target.value) })} /></Field>
      <div className="actions">
        <Button tone="secondary" onClick={() => onChange({ ...crop, rotation: ((crop.rotation + 90) % 360) as Crop["rotation"] })}><RotateCw size={20} /> Rotate</Button>
        <Button tone="ghost" onClick={() => onChange({ ...defaultCrop, rotation: crop.rotation })}>Reset</Button>
      </div>
    </div>
    <p className="muted">Drag the photo to position it. The frame is the 16:9 recipe card.</p>
  </div>;
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close]);
  return <div className="photo-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <section className="panel stack">
      <div className="line"><h2>{title}</h2><Button tone="ghost" aria-label="Close" onClick={close}><X /></Button></div>
      {children}
    </section>
  </div>;
}

type Draft = { file: File; source: Source; crop: Crop; caption: string; preview: string };

async function preview(source: Source, crop: Crop) {
  const card = drawCard(rotated(source, crop.rotation), crop, 480);
  return card.toDataURL("image/jpeg", 0.8);
}

function AddPhotos({ recipeId, hasMain, close }: { recipeId: string; hasMain: boolean; close: () => void }) {
  const store = usePhotos()!;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [main, setMain] = useState<number | null>(hasMain ? null : 0);
  const [editing, setEditing] = useState<number>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  async function choose(list: FileList | null) {
    setError("");
    const next: Draft[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list ?? [])) {
      try { const source = await decode(file); next.push({ file, source, crop: defaultCrop, caption: "", preview: await preview(source, defaultCrop) }); }
      catch (cause) { problems.push(message(cause)); }
    }
    setDrafts((current) => [...current, ...next]);
    if (problems.length) setError(problems.join(" "));
  }
  async function save() {
    if (!drafts.length || busy) return;
    setBusy(true); setError(""); setDone(0);
    try {
      const items: NewPhoto[] = [];
      for (const draft of drafts) items.push({ file: draft.file, crop: draft.crop, caption: draft.caption, rendered: await render(draft.source, draft.crop), hash: await sha256(draft.file) });
      await store.add(recipeId, items, main, setDone);
      close();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  if (editing !== undefined) {
    const draft = drafts[editing];
    return <Dialog title="Edit photo" close={() => setEditing(undefined)}>
      <Cropper source={draft.source} crop={draft.crop} onChange={(crop) => setDrafts((list) => list.map((item, index) => index === editing ? { ...item, crop } : item))} />
      <div className="actions"><Button onClick={() => void preview(draft.source, draft.crop).then((url) => {
        setDrafts((list) => list.map((item, index) => index === editing ? { ...item, preview: url } : item)); setEditing(undefined);
      })}>Done</Button></div>
    </Dialog>;
  }
  return <Dialog title="Add photos" close={close}>
    <label className="hb-btn hb-btn--app hb-btn--secondary file-pick"><ImagePlus size={20} aria-hidden="true" /> Choose photos
      <input type="file" accept={photoAccept} multiple className="sr-only" onChange={(e) => { void choose(e.target.files); e.target.value = ""; }} /></label>
    <p className="muted">JPEG, PNG, WebP or HEIC. Photos are straightened, cropped to 16:9 for the recipe card and saved without location data.</p>
    {drafts.length > 0 && <div className="photo-drafts">{drafts.map((draft, index) => <article key={`${draft.file.name}-${index}`} className="panel stack compact">
      <img src={draft.preview} alt={`Preview of ${draft.file.name}`} className="photo-card-img" />
      <label className="check"><input type="radio" name="main-photo" checked={main === index} onChange={() => setMain(index)} /><span>Main photo</span></label>
      <Field label="Caption (optional)"><input maxLength={300} value={draft.caption} onChange={(e) => setDrafts((list) => list.map((item, i) => i === index ? { ...item, caption: e.target.value } : item))} /></Field>
      <div className="actions"><Button tone="secondary" onClick={() => setEditing(index)}>Edit photo</Button>
        <Button tone="ghost" onClick={() => { setDrafts((list) => list.filter((_, i) => i !== index)); setMain((m) => m === index ? null : m !== null && m > index ? m - 1 : m); }}>Remove</Button></div>
    </article>)}</div>}
    {hasMain && drafts.length > 0 && <label className="check"><input type="radio" name="main-photo" checked={main === null} onChange={() => setMain(null)} /><span>Keep the current main photo</span></label>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {busy && <p role="status">Saving {Math.min(done + 1, drafts.length)} of {drafts.length}…</p>}
    <div className="actions"><Button onClick={() => void save()} disabled={!drafts.length || busy}>{busy ? "Saving…" : `Save ${drafts.length || ""} photo${drafts.length === 1 ? "" : "s"}`}</Button>
      <Button tone="ghost" onClick={close}>Cancel</Button></div>
  </Dialog>;
}

function EditExisting({ photo, close, replace }: { photo: RecipePhoto; close: () => void; replace: boolean }) {
  const store = usePhotos()!;
  const [source, setSource] = useState<Source>();
  const [file, setFile] = useState<File>();
  const [crop, setCrop] = useState<Crop>(replace ? defaultCrop : { ...defaultCrop, ...photo.crop, rotation: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (replace) return;
    // Edits start from the saved photo, which already has its rotation applied.
    void store.original(photo).then(decode).then(setSource).catch((cause) => setError(message(cause)));
  }, [photo, replace, store]);
  async function save() {
    if (!source || busy) return;
    setBusy(true); setError("");
    try {
      const rendered = await render(source, crop);
      await store.rewrite(photo, rendered, crop, file ? { file, hash: await sha256(file) } : undefined);
      close();
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Dialog title={replace ? "Replace photo" : "Edit photo"} close={close}>
    {replace && <label className="hb-btn hb-btn--app hb-btn--secondary file-pick"><ImagePlus size={20} aria-hidden="true" /> Choose a new photo
      <input type="file" accept={photoAccept} className="sr-only" onChange={(e) => {
        const chosen = e.target.files?.[0];
        if (chosen) void decode(chosen).then((decoded) => { setFile(chosen); setSource(decoded); setCrop(defaultCrop); }).catch((cause) => setError(message(cause)));
      }} /></label>}
    {source ? <Cropper source={source} crop={crop} onChange={setCrop} /> : !replace && !error && <p role="status">Loading photo…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions"><Button onClick={() => void save()} disabled={!source || busy}>{busy ? "Saving…" : "Save photo"}</Button><Button tone="ghost" onClick={close}>Cancel</Button></div>
  </Dialog>;
}

// Main photo, the four primary actions and the gallery for one recipe. Nothing here touches recipe versions.
export function RecipePhotoSection({ recipeId, name }: { recipeId: string; name: string }) {
  const store = usePhotos();
  const photos = store?.forRecipe(recipeId) ?? [];
  const primary = photos.find((item) => item.is_primary);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = photos.find((item) => item.id === selectedId) ?? primary ?? photos[0];
  const [dialog, setDialog] = useState<"add" | "edit" | "replace" | "view" | "remove">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [captionDraft, setCaptionDraft] = useState("");
  useEffect(() => { setCaptionDraft(selected?.caption ?? ""); }, [selected?.id, selected?.caption]);
  if (!store) return null;
  const run = async (action: () => Promise<unknown>, success: string) => {
    setError(""); setNotice("");
    try { await action(); setNotice(success); } catch (cause) { setError(message(cause)); }
  };
  return <section className="panel stack recipe-photos" aria-label="Recipe photos">
    {primary ? <button type="button" className="recipe-hero" onClick={() => { setSelectedId(primary.id); setDialog("view"); }} aria-label={`View main photo of ${name} full screen`}>
      <PhotoImg photo={primary} variant="card" alt={`${name}${primary.caption ? `: ${primary.caption}` : ""}`} />
    </button> : <div className="recipe-thumb" aria-hidden="true"><BookOpen size={26} />No main photo yet</div>}
    <div className="actions photo-actions">
      <Button onClick={() => setDialog("add")}><ImagePlus size={20} aria-hidden="true" /> Add Photos</Button>
      {selected && <>
        <Button tone="secondary" disabled={selected.is_primary} onClick={() => void run(() => store.setMain(selected), "Main photo updated.")}><Star size={20} aria-hidden="true" /> Set as Main</Button>
        <Button tone="secondary" onClick={() => setDialog("edit")}>Edit Photo</Button>
        <Button tone="secondary" onClick={() => setDialog("replace")}>Replace</Button>
        <Button tone="ghost" onClick={() => setDialog("remove")}>Remove</Button>
      </>}
    </div>
    {notice && <p role="status" className="notice success">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {dialog === "remove" && selected && <div className="notice warning stack compact"><p>Remove this photo from {name}? The recipe stays as it is.</p>
      <div className="actions"><Button onClick={() => void run(async () => { await store.remove(selected); setSelectedId(undefined); setDialog(undefined); }, "Photo removed.")}>Remove photo</Button>
        <Button tone="ghost" onClick={() => setDialog(undefined)}>Keep it</Button></div></div>}
    {photos.length > 0 && <><h2>Photo gallery</h2>
      <ul className="photo-gallery">{photos.map((photo, index) => <li key={photo.id} className={photo.id === selected?.id ? "selected" : undefined}>
        <button type="button" className="photo-tile" aria-pressed={photo.id === selected?.id} onClick={() => setSelectedId(photo.id)}
          onDoubleClick={() => { setSelectedId(photo.id); setDialog("view"); }} aria-label={`Select photo ${index + 1}${photo.is_primary ? ", main photo" : ""}`}>
          <PhotoImg photo={photo} variant="thumb" alt={photo.caption || `${name} photo ${index + 1}`} />
          {photo.is_primary && <span className="photo-badge"><Star size={14} aria-hidden="true" /> Main</span>}
        </button>
        {photo.caption && <p className="muted photo-caption">{photo.caption}</p>}
      </li>)}</ul>
      {selected && <div className="line photo-tools">
        <div className="actions">
          <Button tone="ghost" aria-label="Move earlier" disabled={photos[0]?.id === selected.id} onClick={() => void run(() => store.move(selected, -1), "Order saved.")}><ArrowLeft /></Button>
          <Button tone="ghost" aria-label="Move later" disabled={photos.at(-1)?.id === selected.id} onClick={() => void run(() => store.move(selected, 1), "Order saved.")}><ArrowRight /></Button>
          <Button tone="ghost" onClick={() => setDialog("view")}>View full screen</Button>
        </div>
        <form className="actions" onSubmit={(e) => { e.preventDefault(); void run(() => store.update(selected, { caption: captionDraft.trim().slice(0, 300) }), "Caption saved."); }}>
          <Field label="Caption"><input maxLength={300} value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} placeholder="Optional" /></Field>
          <Button tone="secondary" type="submit">Save caption</Button>
        </form>
      </div>}
    </>}
    {dialog === "add" && <AddPhotos recipeId={recipeId} hasMain={Boolean(primary)} close={() => { setDialog(undefined); setNotice("Photos saved."); }} />}
    {(dialog === "edit" || dialog === "replace") && selected && <EditExisting photo={selected} replace={dialog === "replace"} close={() => setDialog(undefined)} />}
    {dialog === "view" && selected && <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={() => setDialog(undefined)}>
      <PhotoImg photo={selected} variant="full" alt={selected.caption || name} />
      {selected.caption && <p>{selected.caption}</p>}
      <Button tone="secondary" aria-label="Close photo viewer" onClick={() => setDialog(undefined)}><X /> Close</Button>
    </div>}
  </section>;
}
