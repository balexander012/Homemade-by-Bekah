"use client";

import { useEffect, useState } from "react";
import { Timer, Volume2 } from "lucide-react";
import { activeVersions, canBake, currentSteps, formatAmount, modes, newSession, nextStep, scale, sharedIngredients, type Entry, type Selection, type Session, type Version } from "@/lib/domain";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { RecipePicker } from "./planner";
import { Button, Field, Heading, Status, message } from "./ui";

export function StartSession({ date, event, initialVersion, store, close, started }: {
  date: string; event?: Entry<"event">; initialVersion?: string; store: WorkspaceStore;
  close: () => void; started: (id: string) => void;
}) {
  const all = store.library.versions;
  const valid = (version: Version) => canBake(version.document) && ["Ready for Testing", "Tested"].includes(version.document.status);
  const [selection, setSelection] = useState<Selection[]>(() => (event?.document.recipes ??
    (initialVersion ? [{ versionId: initialVersion, target: null }] : [])).filter((row) => all.some((version) => row.versionId === version.id && valid(version))));
  const [title, setTitle] = useState(event?.document.title ?? "Baking session");
  const [mode, setMode] = useState<Session["mode"]>("Sequential");
  const [error, setError] = useState("");
  const versions = [...activeVersions(store.library), ...all.filter((item) =>
    selection.some((row) => row.versionId === item.id) && !activeVersions(store.library).some((version) => version.id === item.id))].filter(valid);
  const skipped = event?.document.recipes.filter((row) => !all.some((item) => row.versionId === item.id && valid(item))) ?? [];
  return <><Heading title="Start baking" /><form className="stack" onSubmit={(e) => {
    e.preventDefault();
    try { started(store.put("session", { ...newSession(title, date, selection, event?.id), mode })); } catch (cause) { setError(message(cause)); }
  }}>
    <section className="panel stack">
      <Field label="Session name"><input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Baking mode"><select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>{modes.map((name) => <option key={name}>{name}</option>)}</select></Field>
      {skipped.length > 0 && <p className="warning">Some scheduled recipes still need verified measurements or instructions.</p>}
      {!versions.length && <p className="muted">Set a verified recipe to Ready for Testing to use it in a session.</p>}
      <RecipePicker versions={versions} selected={selection} onChange={setSelection} />
    </section>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions"><Button type="submit" disabled={!selection.length}>Begin session</Button><Button tone="ghost" onClick={close}>Cancel</Button></div>
  </form></>;
}

function timeText(ms: number) {
  const seconds = Math.ceil(Math.abs(ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function BakingSession({ entry, store, now, photos, sound, audioReady }: {
  entry: Entry<"session">; store: WorkspaceStore; now: number; photos: () => void; sound: () => void; audioReady: boolean;
}) {
  const session = entry.document;
  const versions = store.library.versions;
  const [override, setOverride] = useState("");
  const [timerMinutes, setTimerMinutes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const recipeSteps = currentSteps(session, versions, now);
  const suggested = nextStep(session, versions, now);
  const focused = recipeSteps.find((item) => item.version.id === override) ?? suggested;
  const visible = session.mode === "Side-by-Side" ? recipeSteps.slice(0, 3) : focused ? [focused] : [];
  const active = session.status === "Active";
  const allDone = session.recipes.every((recipe) => {
    const version = versions.find((version) => version.id === recipe.versionId);
    return version && version.document.steps.every((step) => recipe.completed.includes(step.id));
  });
  const ingredients = sharedIngredients(session.recipes, versions);
  const equipment = new Map<string, string[]>();
  for (const recipe of session.recipes) {
    const item = versions.find((version) => version.id === recipe.versionId)?.document;
    for (const tool of item?.equipment ?? []) {
      const key = tool.toLowerCase();
      equipment.set(key, [...(equipment.get(key) ?? []), item!.name]);
    }
  }
  const save = (patch: Partial<Session>) => {
    try { setError(""); store.put("session", { ...session, ...patch }, entry.id); }
    catch (cause) { setError(message(cause)); }
  };
  const togglePrep = (key: string) => save({ prepared: session.prepared.includes(key) ? session.prepared.filter((item) => item !== key) : [...session.prepared, key] });
  const startTimer = (versionId: string, stepId: string, label: string, minutes: number | undefined) => {
    if (!minutes || minutes < 0.01 || minutes > 10080) { setError("Enter a timer duration from 0.01 to 10,080 minutes."); return; }
    sound();
    const start = Date.now();
    save({ timers: [...session.timers, { id: crypto.randomUUID(), versionId, stepId, label: label.slice(0, 200), start, deadline: start + Math.round(minutes * 60000), cancelled: false }] });
  };
  const timers = session.timers.filter((timer) => !timer.cancelled);
  const expired = timers.filter((timer) => timer.deadline <= now);
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let stopped = false;
    let lock: WakeLockSentinel | undefined;
    const wake = async () => {
      if (stopped || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const requested = await navigator.wakeLock.request("screen");
        if (stopped) await requested.release();
        else lock = requested;
      } catch { /* Power saving settings may deny a wake lock. */ }
    };
    void wake();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", wake);
      void lock?.release();
    };
  }, [active]);
  return <>
    <Heading title={session.title} detail={active ? "In the kitchen" : "Completed session"}>{allDone && <Button onClick={photos}>Open photo checklist</Button>}</Heading>
    <div className="stack">
      {error && <p className="notice error" role="alert">{error}</p>}
      {active && expired.length > 0 && <p role="status" className="notice error">Timer ready · {expired.map((timer) => timer.label).join(", ")}. Check the bake and mark the step when it’s done.</p>}
      <div className="actions">
        <Field label="Baking mode"><select disabled={!active} value={session.mode} onChange={(e) => { setOverride(""); save({ mode: e.target.value as Session["mode"] }); }}>
          {modes.map((name) => <option key={name}>{name}</option>)}</select></Field>
        {active && recipeSteps.length > 1 && session.mode !== "Side-by-Side" && <Field label="Focus recipe">
          <select value={override} onChange={(e) => setOverride(e.target.value)}><option value="">Suggested order</option>
            {recipeSteps.map((item) => <option key={item.version.id} value={item.version.id}>{item.version.document.name}</option>)}</select>
        </Field>}
        {active && <Button tone="ghost" onClick={sound}>{audioReady ? "Timer sound on" : "Enable timer sound"}</Button>}
      </div>
      <section className="panel"><details><summary>Shared ingredients and equipment</summary><div className="cols">
        <div><h2>Gather ingredients</h2>{ingredients.map((row) => <div className="row" key={row.key}>
          <label className="check"><input type="checkbox" checked={session.prepared.includes(row.key)} disabled={!active} onChange={() => togglePrep(row.key)} />
            <span>{row.total ? formatAmount(row.total) : "Check amount"} · {row.name}{row.preparation ? ` · ${row.preparation}` : ""}</span></label>
          {row.allocations.map((item, index) => <p className="muted" key={index}>{item.recipe} · {formatAmount(item.measurement)}{item.measurement.warning ? ` · ${item.measurement.warning}` : ""}</p>)}
        </div>)}</div>
        <div><h2>Set out equipment</h2>{[...equipment].map(([name, recipes]) => <div className="row" key={name}><label className="check">
          <input type="checkbox" disabled={!active} checked={session.prepared.includes(`equipment:${name}`)} onChange={() => togglePrep(`equipment:${name}`)} /><span>{name}</span></label>
          <p className="muted">{recipes.join(", ")}</p></div>)}
          {equipment.size === 0 && <p className="muted">No equipment is listed in these recipes.</p>}
        </div>
      </div></details></section>
      {visible.length > 0 && <section className="stack"><h2>{session.mode === "Side-by-Side" ? "Current steps" : "Up next"}</h2>
        {session.mode === "Side-by-Side" && recipeSteps.length > 3 && <p className="muted">The next batch appears as a current batch finishes.</p>}
        <div className={visible.length > 1 ? "tiles" : "stack"}>{visible.map(({ version, progress, step, waiting, timer }) => {
          const recipe = version.document;
          const index = recipe.steps.indexOf(step);
          const otherOven = recipeSteps.find((item) => item.waiting && item.step.kind === "Oven" && item.version.id !== version.id);
          const blocked = step.kind === "Oven" && (otherOven || session.oven.phase === "Occupied" ||
            (session.oven.phase === "Preheating" && session.oven.temperature !== step.temperature));
          const stepKey = `${version.id}:${step.id}`;
          return <article className="panel stack" key={version.id}>
            <div className="line"><p className="eyebrow">Step {index + 1} of {recipe.steps.length}</p><Status>{waiting ? "Timer running" : step.kind}</Status></div>
            <h3>{recipe.name}</h3>
            <p className="step-copy">{step.instruction}</p>
            {step.temperature && <p><strong>{step.temperature} °F</strong>{step.minutes ? ` · ${step.minutes} min` : ""}</p>}
            {progress.target && step.kind === "Oven" && <p className="warning">Check pan size, tray space, and bake time for this batch size.</p>}
            {blocked && <p className="notice warning">Oven in use or preheating to a different temperature. Wait or choose another recipe.</p>}
            {recipe.ingredients.filter((item) => step.ingredients.includes(item.id)).map((item) => {
              const measurement = scale(item, recipe, progress.target);
              return <div className="row" key={item.id}><p className="quantity">{formatAmount(measurement)}</p><p>{item.name}{item.preparation ? ` · ${item.preparation}` : ""}</p>
                {measurement.warning && <p className="warning">{measurement.warning}</p>}</div>;
            })}
            {active && !waiting && <div className="actions">
              <Field label="Timer minutes"><input type="number" min="0.01" step="any" value={timerMinutes[stepKey] ?? step.minutes ?? ""}
                onChange={(e) => setTimerMinutes({ ...timerMinutes, [stepKey]: e.target.value })} /></Field>
              <Button tone="secondary" disabled={Boolean(blocked)} onClick={() => startTimer(version.id, step.id, `${recipe.name} · Step ${index + 1}`, Number(timerMinutes[stepKey] ?? step.minutes))}><Timer size={20} /> Start timer</Button>
            </div>}
            {waiting && timer && <p className="timer">{timeText(timer.deadline - now)}</p>}
            <div className="actions">
              {"speechSynthesis" in window && <Button tone="ghost" onClick={() => {
                window.speechSynthesis.cancel();
                const measurements = recipe.ingredients.filter((item) => step.ingredients.includes(item.id))
                  .map((item) => `${formatAmount(scale(item, recipe, progress.target))} ${item.name}`).join(". ");
                window.speechSynthesis.speak(new SpeechSynthesisUtterance([step.instruction, measurements].filter(Boolean).join(". ")));
              }}><Volume2 size={20} /> Read step</Button>}
              {active && <Button onClick={() => {
                save({ recipes: session.recipes.map((item) => item.versionId === version.id ? { ...item, completed: [...item.completed, step.id] } : item),
                  timers: session.timers.map((item) => item.versionId === version.id && item.stepId === step.id ? { ...item, cancelled: true } : item) });
                setOverride("");
              }}>Complete step</Button>}
            </div>
          </article>;
        })}</div>
      </section>}
      <section className="panel stack"><h2>Batch progress</h2>
        {session.recipes.map((item) => {
          const version = versions.find((candidate) => candidate.id === item.versionId);
          return <div className="line row" key={item.versionId}><p><strong>{version?.document.name ?? "Recipe unavailable"}</strong> · {item.completed.length} of {version?.document.steps.length ?? "?"} steps</p>
            {active && item.completed.length > 0 && <Button tone="ghost" onClick={() => save({ recipes: session.recipes.map((row) => row.versionId === item.versionId ? { ...row, completed: row.completed.slice(0, -1) } : row) })}>Undo last step</Button>}
          </div>;
        })}
      </section>
      {timers.length > 0 && <section className="stack"><h2>Timers</h2><div className="tiles">{timers.map((timer) => <article className={`panel stack ${timer.deadline <= now ? "timer-alert" : ""}`} key={timer.id}>
        <h3>{timer.label}</h3><p className="timer">{timer.deadline <= now ? "+" : ""}{timeText(timer.deadline - now)}</p>
        <p className="muted">{timer.deadline <= now ? "Overdue" : "Remaining"} · {timeText(Math.max(0, now - timer.start))} elapsed</p>
        {active && <div className="actions"><Button tone="secondary" onClick={() => save({ timers: session.timers.map((row) => row.id === timer.id ? { ...row, deadline: row.deadline + 60000 } : row) })}>Add 1 minute</Button>
          <Button tone="ghost" onClick={() => save({ timers: session.timers.map((row) => row.id === timer.id ? { ...row, cancelled: true } : row) })}>{timer.deadline <= now ? "Dismiss timer" : "Cancel timer"}</Button></div>}
      </article>)}</div><p className="muted">Timer sound plays while the app is open. Return to the app to see elapsed time after a lock or reload.</p></section>}
      <section className="panel"><details><summary>Oven and tray notes</summary><div className="stack">
        <div className="cols"><Field label="Oven status"><select disabled={!active} value={session.oven.phase} onChange={(e) => save({ oven: { ...session.oven, phase: e.target.value as Session["oven"]["phase"] } })}>
          {["Available", "Preheating", "Occupied"].map((name) => <option key={name}>{name}</option>)}</select></Field>
          <Field label="Current oven temperature (°F)"><input type="number" min="75" max="650" key={session.oven.temperature} disabled={!active} defaultValue={session.oven.temperature ?? ""}
            onBlur={(e) => save({ oven: { ...session.oven, temperature: e.target.value ? Number(e.target.value) : undefined } })} /></Field></div>
        <Field label="Racks, trays and cooling"><textarea disabled={!active} defaultValue={session.oven.notes}
          onBlur={(e) => save({ oven: { ...session.oven, notes: e.target.value } })} /></Field>
      </div></details></section>
      {allDone && active && <section className="panel stack"><h2>Wrap up</h2><p>Save tasting notes and mark the session complete when you’re finished.</p>
        <div className="actions"><Button tone="secondary" onClick={photos}>Photos and feedback</Button><Button onClick={() => save({ status: "Completed", timers: session.timers.map((timer) => ({ ...timer, cancelled: true })) })}>Complete session</Button></div>
      </section>}
    </div>
  </>;
}
