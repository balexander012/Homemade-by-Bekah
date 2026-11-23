"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChefHat, Clock3, ListChecks, Play, RotateCcw, Timer, Volume2 } from "lucide-react";
import { clearBakingSession, currentSteps, formatAmount, modes, nextStep, ovenBlocked, restoreBakingSession, scale, sharedIngredients, timerTime, type Entry, type Session } from "@/lib/domain";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, message } from "./ui";
import { RecipeImage } from "./recipe-photos";
import { SideBySideSteps } from "./side-by-side";

type View = "steps" | "prep" | "overview" | "finish";

export function BakeLanding({ sessions, now, start, resume, store }: {
  sessions: Entry<"session">[]; now: number; start: () => void; resume: (id: string) => void; store: WorkspaceStore;
}) {
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const visible = sessions.filter((item) => !item.document.cleared);
  const active = visible.filter((item) => item.document.status === "Active");
  const history = visible.filter((item) => item.document.status === "Completed")
    .sort((a, b) => b.document.date.localeCompare(a.document.date));
  const cleared = sessions.filter((item) => item.document.cleared)
    .sort((a, b) => b.document.date.localeCompare(a.document.date));
  const chosen = visible.filter((item) => selected.includes(item.id));
  const toggleSelection = (id: string) => {
    setSelected((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
    setConfirmClear(false);
  };
  const stopManaging = () => {
    setManaging(false); setSelected([]); setConfirmClear(false); setError("");
  };
  const clearSelected = () => {
    try {
      for (const item of chosen) store.put("session", clearBakingSession(item.document), item.id);
      stopManaging();
    } catch (cause) { setError(message(cause)); }
  };
  const restore = (item: Entry<"session">) => {
    try { setError(""); store.put("session", restoreBakingSession(item.document), item.id); }
    catch (cause) { setError(message(cause)); }
  };
  const sessionRow = (item: Entry<"session">, finished: boolean) => {
    const timers = item.document.timers.filter((timer) => !timer.cancelled);
    const next = timers.sort((a, b) => a.deadline - b.deadline)[0];
    return <div className="bake-manage-row" key={item.id}>
      {managing && <label className="bake-manage-select">
        <input type="checkbox" checked={selected.includes(item.id)}
          aria-label={"Select " + item.document.title} onChange={() => toggleSelection(item.id)} />
      </label>}
      <button className="bake-session-row" type="button" onClick={() => managing ? toggleSelection(item.id) : resume(item.id)}>
        <span className="bake-session-symbol">{finished ? <Check size={18}/> : <Play size={20}/>}</span>
        <span className="bake-session-copy">
          <strong>{item.document.title}</strong>
          <small>{item.document.date} · {item.document.recipes.length} recipes
            {next && !finished ? " · Timer " + timerTime(next.deadline - now) : ""}</small>
        </span>
        {managing ? <span className="bake-selected-caption">{selected.includes(item.id) ? "Selected" : "Select"}</span>
          : <ArrowRight size={18} aria-hidden="true" />}
      </button>
    </div>;
  };
  return <div className="stack bake-landing">
    <Heading title="Bake" detail="Your kitchen"><Button onClick={start}><ChefHat size={18} aria-hidden="true" /> New baking session</Button></Heading>
    {(visible.length > 0 || managing) && <div className="bake-manage-bar">
      <p className="muted">Only real baking sessions should stay in your kitchen history.</p>
      <Button tone="secondary" onClick={() => { if (managing) stopManaging(); else setManaging(true); }}>
        {managing ? "Done managing" : "Manage sessions"}
      </Button>
    </div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {managing && <section className="bake-manage-tools" aria-label="Clear test baking sessions">
      <p>Select the sessions you were testing. Recipes and saved photos are not deleted.</p>
      <div className="actions">
        <Button tone="secondary" disabled={!selected.length} onClick={() => setConfirmClear(true)}>
          Clear selected ({selected.length})
        </Button>
        {selected.length > 0 && <Button tone="ghost" onClick={() => { setSelected([]); setConfirmClear(false); }}>Deselect all</Button>}
      </div>
      {confirmClear && <div className="bake-clear-confirm" role="group" aria-label="Confirm clearing sessions">
        <strong>Clear {chosen.length} baking session{chosen.length === 1 ? "" : "s"}?</strong>
        <p>These sessions disappear from Today, Bake, Photos and recipe activity. Running timers stop. You can restore the sessions later.</p>
        <ul>{chosen.map((item) => <li key={item.id}>{item.document.title} · {item.document.date}</li>)}</ul>
        <div className="actions">
          <Button onClick={clearSelected} disabled={!chosen.length}>Yes, clear {chosen.length}</Button>
          <Button tone="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
        </div>
      </div>}
    </section>}
    {active.length > 0 ? <section className="stack compact">
      <h2>Continue baking</h2>
      <div className="bake-session-list">{active.map((item) => sessionRow(item, false))}</div>
    </section> : !history.length ? <section className="panel empty-state tinted">
      <ChefHat size={28} aria-hidden="true"/>
      <h2 className="display">Ready for your next bake?</h2>
      <p className="muted">Choose a recipe, prepare ingredients, and follow each step in the kitchen.</p>
      <Button onClick={start}>Start baking</Button>
    </section> : null}
    {history.length > 0 && <section className="stack compact">
      <h2>Recent sessions</h2>
      <div className="bake-session-list">{history.slice(0, managing || showAllHistory ? history.length : 8)
        .map((item) => sessionRow(item, true))}</div>
      {!managing && history.length > 8 && <Button tone="ghost" onClick={() => setShowAllHistory(!showAllHistory)}>
        {showAllHistory ? "Show recent sessions" : "Show all " + history.length + " sessions"}
      </Button>}
    </section>}
    {cleared.length > 0 && <details className="bake-cleared-sessions">
      <summary>Cleared sessions ({cleared.length})</summary>
      <p className="muted">Test sessions are hidden from the active workspace. Restore a session to see its saved progress and photos again.</p>
      <div className="bake-session-list">{cleared.map((item) => <div className="bake-cleared-row" key={item.id}>
        <span><strong>{item.document.title}</strong><small>{item.document.date} · {item.document.recipes.length} recipes</small></span>
        <Button tone="secondary" onClick={() => restore(item)}>Restore</Button>
      </div>)}</div>
    </details>}
  </div>;
}

export function FocusedBakingSession({ entry, store, now, photos, sound, audioReady, exit }: {
  entry: Entry<"session">; store: WorkspaceStore; now: number; photos: () => void; sound: () => void; audioReady: boolean; exit: () => void;
}) {
  const session = entry.document;
  const versions = store.library.versions;
  const [view, setView] = useState<View>("steps");
  const [showTimers, setShowTimers] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState("");
  const [timerSetupOpen, setTimerSetupOpen] = useState(false);
  const stepCardRef = useRef<HTMLElement>(null);
  const previousStepKey = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const active = session.status === "Active";
  const recipeSteps = currentSteps(session, versions, now);
  const suggested = nextStep(session, versions, now);
  const focused = recipeSteps.find((item) => item.version.id === session.focusVersionId) ?? suggested ?? recipeSteps[0];
  const focusedStepKey = focused ? focused.version.id + ":" + focused.step.id : null;
  useEffect(() => {
    if (previousStepKey.current && focusedStepKey && previousStepKey.current !== focusedStepKey) {
      if (stepCardRef.current) stepCardRef.current.scrollTop = 0;
      stepCardRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    }
    previousStepKey.current = focusedStepKey;
  }, [focusedStepKey]);
  const total = session.recipes.reduce((count, item) => count + (versions.find((v) => v.id === item.versionId)?.document.steps.length ?? 0), 0);
  const completed = session.recipes.reduce((count, item) => count + item.completed.length, 0);
  const allDone = total > 0 && completed >= total;
  const timers = session.timers.filter((timer) => !timer.cancelled).sort((a, b) => a.deadline - b.deadline);
  const expired = timers.filter((timer) => timer.deadline <= now);
  const ingredients = sharedIngredients(session.recipes, versions);
  const equipment = [...new Set(session.recipes.flatMap((item) => versions.find((v) => v.id === item.versionId)?.document.equipment ?? []))];
  const save = (patch: Partial<Session>) => {
    try { setError(""); store.put("session", { ...session, ...patch }, entry.id); }
    catch (cause) { setError(message(cause)); }
  };
  const setFocus = (id: string) => {
    save({ focusVersionId: id });
    setTimerMinutes("");
    setTimerSetupOpen(false);
    setView("steps");
  };
  const completeStep = () => {
    if (!focused || !active) return;
    const { version, step } = focused;
    save({
      recipes: session.recipes.map((item) => item.versionId === version.id ?
        { ...item, completed: item.completed.includes(step.id) ? item.completed : [...item.completed, step.id] } : item),
      timers: session.timers.map((item) => item.versionId === version.id && item.stepId === step.id ? { ...item, cancelled: true } : item),
      focusVersionId: undefined,
    });
    setTimerMinutes("");
    setTimerSetupOpen(false);
  };
  const undo = (versionId: string) => save({
    recipes: session.recipes.map((item) => item.versionId === versionId && item.completed.length ?
      { ...item, completed: item.completed.slice(0, -1) } : item),
    focusVersionId: versionId,
  });
  const togglePrep = (key: string) => save({ prepared: session.prepared.includes(key) ?
    session.prepared.filter((item) => item !== key) : [...session.prepared, key] });
  const startTimer = () => {
    if (!focused) return;
    const minutes = Number(timerMinutes || focused.step.minutes || 0);
    if (!Number.isFinite(minutes) || minutes < 0.01 || minutes > 10080) {
      setError("Enter a timer between 0.01 and 10,080 minutes."); return;
    }
    sound();
    const start = Date.now();
    save({ timers: [...session.timers, { id: crypto.randomUUID(), versionId: focused.version.id,
      stepId: focused.step.id, label: focused.version.document.name + " · Step " +
        (focused.version.document.steps.indexOf(focused.step) + 1), start,
      deadline: start + Math.round(minutes * 60000), cancelled: false }] });
    setShowTimers(true);
    setTimerSetupOpen(false);
    setTimerMinutes("");
  };
  const updateTimer = (id: string, action: "add" | "cancel") => save({ timers: session.timers.map((timer) =>
    timer.id === id ? action === "cancel" ? { ...timer, cancelled: true } : { ...timer, deadline: timer.deadline + 60000 } : timer) });
  const finish = () => {
    if (!allDone) return;
    save({ status: "Completed", timers: session.timers.map((timer) => ({ ...timer, cancelled: true })) });
    setConfirmFinish(false);
    setView("finish");
  };
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let stopped = false;
    let lock: WakeLockSentinel | undefined;
    const wake = async () => {
      if (stopped || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const requested = await navigator.wakeLock.request("screen");
        if (stopped) await requested.release(); else lock = requested;
      } catch { /* Browsers may deny the screen wake lock. */ }
    };
    void wake();
    document.addEventListener("visibilitychange", wake);
    return () => { stopped = true; document.removeEventListener("visibilitychange", wake); void lock?.release(); };
  }, [active]);

  return <div className="bake-focus stack">
    <header className="bake-compact-header">
      <div className="bake-header-content">
        <button className="bake-back" type="button" onClick={exit} aria-label="Leave baking session"><ArrowLeft size={18}/><span>All sessions</span></button>
        <div className="bake-session-heading">
          <div className="bake-session-heading-line"><h1>Baking session</h1><span className="bake-state">{active ? "In progress" : "Completed"}</span></div>
          <p className="bake-session-summary" title={session.title}>{session.title}</p>
          <p className="bake-session-date">{session.date} · {session.recipes.length} recipes</p>
        </div>
      </div>
    </header>
    <div className="bake-progress-head"><strong>{completed} of {total} steps complete</strong><span>{total ? Math.round(completed / total * 100) : 0}%</span></div>
    <div className="bake-progress-track" role="progressbar" aria-label="Baking progress" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total || 1}>
      <span style={{ width: (total ? completed / total * 100 : 0) + "%" }}/></div>
    <nav className="bake-subnav" aria-label="Baking session sections">
      {([["steps", "Steps", BookOpen], ["prep", "Prep", ListChecks], ["overview", "Overview", ChefHat], ["finish", "Finish", Check]] as const).map(([key, label, Icon]) =>
        <button type="button" key={key} aria-current={view === key ? "page" : undefined} onClick={() => setView(key)}>
          <Icon size={18} aria-hidden="true"/>{label}</button>)}
    </nav>
    {error && <p className="notice error" role="alert">{error}</p>}
    {timers.length > 0 && <section className="bake-timer-section">
      <button type="button" className="bake-timer-toggle" onClick={() => setShowTimers(!showTimers)} aria-expanded={showTimers}>
        <Timer size={19} aria-hidden="true"/><strong>{expired.length ? expired.length + " timer ready" : timers.length + " active timer" + (timers.length === 1 ? "" : "s")}</strong>
        <span>{timerTime(timers[0].deadline - now)}{timers[0].deadline <= now ? " overdue" : " remaining"}</span>
        <span aria-hidden="true">{showTimers ? "−" : "+"}</span>
      </button>
      {showTimers && <div className="bake-timer-list">{timers.map((timer) => <div className={"bake-timer-item" + (timer.deadline <= now ? " is-ready" : "")} key={timer.id}>
        <div><strong>{timer.label}</strong><small>{timer.deadline <= now ? "Check the bake" : "Counting down"}</small></div>
        <strong className="bake-timer-clock">{timerTime(timer.deadline - now)}</strong>
        {active && <div className="actions"><Button tone="secondary" onClick={() => updateTimer(timer.id, "add")}>+1 min</Button>
          <Button tone="ghost" onClick={() => updateTimer(timer.id, "cancel")}>{timer.deadline <= now ? "Dismiss" : "Cancel"}</Button></div>}
      </div>)}</div>}
    </section>}
    {view === "steps" && <>
      {session.recipes.length > 1 && <div className="bake-layout-picker">
        <Field label="Baking mode"><select value={session.mode} disabled={!active}
          onChange={(event) => save({ mode: event.target.value as Session["mode"] })}>
          {modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select></Field>
        <p>{session.mode === "Side-by-Side" ? "Both recipes are shown together, with independent steps and timers." :
          "Switch to Side-by-Side to work on both recipes at once."}</p>
      </div>}
      {session.mode === "Side-by-Side" && session.recipes.length > 1
        ? <SideBySideSteps session={session} versions={versions} now={now} active={active}
            sound={sound} save={save}/>
        : <>
      {recipeSteps.length > 1 && <div className="bake-recipe-switch" aria-label="Choose active recipe">
        {recipeSteps.map((item) => <button type="button" key={item.version.id}
          aria-pressed={focused?.version.id === item.version.id} onClick={() => setFocus(item.version.id)}>
          {item.version.document.name}<span>{item.progress.completed.length}/{item.version.document.steps.length}</span></button>)}
      </div>}
      {focused ? <article className="bake-current-step" ref={stepCardRef}>
        <div className="bake-step-meta">
          <span className="bake-recipe-name">{focused.version.document.name}</span>
          <span className="bake-step-count">Step {focused.version.document.steps.indexOf(focused.step) + 1} of {focused.version.document.steps.length}</span>
          <span className="bake-kind">{focused.step.kind}</span>
        </div>
        <h2 className="bake-instruction">{focused.step.instruction}</h2>
        {(focused.step.temperature || focused.step.minutes) && <p className="bake-step-specs">
          {focused.step.temperature ? focused.step.temperature + " °F" : ""}
          {focused.step.temperature && focused.step.minutes ? " · " : ""}
          {focused.step.minutes ? focused.step.minutes + " minutes" : ""}</p>}
        {focused.progress.target && focused.step.kind === "Oven" && <p className="notice warning">Batch size was changed. Check pan capacity and baking time.</p>}
        {ovenBlocked(session, recipeSteps, focused) && <p className="notice warning">Oven status needs attention. Check the oven before starting this step.</p>}
        {focused.waiting && focused.timer && <p className="bake-waiting"><Clock3 size={20} aria-hidden="true"/> Waiting on timer · {timerTime(focused.timer.deadline - now)}</p>}
        {focused.version.document.ingredients.filter((ingredient) => focused.step.ingredients.includes(ingredient.id)).length > 0 && <div className="bake-step-ingredients">
          <h3>For this step</h3>
          {focused.version.document.ingredients.filter((ingredient) => focused.step.ingredients.includes(ingredient.id)).map((ingredient) => {
            const amount = scale(ingredient, focused.version.document, focused.progress.target);
            return <div className="bake-ingredient" key={ingredient.id}>
              <span>{ingredient.name}{ingredient.preparation ? " · " + ingredient.preparation : ""}</span>
              <strong>{formatAmount(amount)}</strong>
              {amount.warning && <small className="warning">{amount.warning}</small>}
            </div>;
          })}</div>}
        {active && <div className="bake-step-tools">
          <Button tone="ghost" onClick={() => {
            if (!("speechSynthesis" in window)) return;
            window.speechSynthesis.cancel();
            const amounts = focused.version.document.ingredients.filter((ingredient) => focused.step.ingredients.includes(ingredient.id))
              .map((ingredient) => formatAmount(scale(ingredient, focused.version.document, focused.progress.target)) + " " + ingredient.name).join(". ");
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(focused.step.instruction + ". " + amounts));
          }}><Volume2 size={18} aria-hidden="true"/> Read aloud</Button>
        </div>}
      </article> : <section className="panel empty-state tinted"><Check size={30}/><h2>All recipe steps are complete</h2>
        <p>Review your results, save notes, and finish the session.</p><Button onClick={() => setView("finish")}>Review and finish</Button></section>}
      {active && focused && <div className="bake-step-actions" role="group" aria-label="Current step actions">
        {timerSetupOpen && <div className="bake-inline-timer">
          <Field label="Timer minutes"><input type="number" min="0.01" max="10080" step="any" inputMode="decimal"
            placeholder={focused.step.minutes ? String(focused.step.minutes) : "Minutes"} value={timerMinutes}
            onChange={(event) => setTimerMinutes(event.target.value)} /></Field>
          <Button tone="secondary" onClick={startTimer}>Start timer</Button>
          <Button tone="ghost" onClick={() => setTimerSetupOpen(false)} aria-label="Close timer setup">Cancel</Button>
        </div>}
        <div className="bake-action-buttons">
          <Button tone="ghost" disabled={!focused.progress.completed.length} onClick={() => undo(focused.version.id)}>
            <RotateCcw size={17}/> Undo</Button>
          <Button tone="secondary" onClick={() => setTimerSetupOpen(!timerSetupOpen)} aria-expanded={timerSetupOpen}>
            <Timer size={17}/> Set timer</Button>
          <Button onClick={completeStep}>Complete step <Check size={18}/></Button>
        </div>
      </div>}
        </>}
    </>}
    {view === "prep" && <div className="bake-prep-grid">
      <section className="panel stack compact"><h2>Gather ingredients</h2><p className="muted">Check off each ingredient as it is ready.</p>
        {ingredients.map((row) => <div className="bake-prep-row" key={row.key}><label className="check">
          <input type="checkbox" disabled={!active} checked={session.prepared.includes(row.key)} onChange={() => togglePrep(row.key)}/>
          <span><strong>{row.name}</strong><small>{row.total ? formatAmount(row.total) : "Check amount"}{row.preparation ? " · " + row.preparation : ""}</small></span>
        </label><details><summary>Recipe breakdown</summary>{row.allocations.map((item, index) =>
          <p className="muted" key={index}>{item.recipe} · {formatAmount(item.measurement)}</p>)}</details></div>)}
      </section>
      <section className="panel stack compact"><h2>Equipment and oven</h2>
        {equipment.map((name) => <label className="check bake-prep-row" key={name}><input type="checkbox" disabled={!active}
          checked={session.prepared.includes("equipment:" + name.toLowerCase())}
          onChange={() => togglePrep("equipment:" + name.toLowerCase())}/><span>{name}</span></label>)}
        {equipment.length === 0 && <p className="muted">No specific equipment listed.</p>}
        <Field label="Oven status"><select disabled={!active} value={session.oven.phase}
          onChange={(e) => save({ oven: { ...session.oven, phase: e.target.value as Session["oven"]["phase"] } })}>
          {["Available", "Preheating", "Occupied"].map((name) => <option key={name}>{name}</option>)}</select></Field>
        <Field label="Oven temperature (°F)"><input type="number" min="75" max="650" disabled={!active}
          key={session.oven.temperature ?? "unset"} defaultValue={session.oven.temperature ?? ""}
          onBlur={(e) => save({ oven: { ...session.oven, temperature: e.target.value ? Number(e.target.value) : undefined } })}/></Field>
        <Field label="Oven and tray notes"><textarea disabled={!active} key={session.oven.notes} defaultValue={session.oven.notes}
          onBlur={(e) => save({ oven: { ...session.oven, notes: e.target.value } })}/></Field>
      </section>
    </div>}
    {view === "overview" && <section className="stack compact"><h2>Recipe progress</h2>
      {session.recipes.map((item) => {
        const version = versions.find((v) => v.id === item.versionId);
        if (!version) return <p key={item.versionId} className="notice warning">A recipe version is unavailable.</p>;
        const count = version.document.steps.length;
        return <div key={item.versionId} className="bake-overview-row">
          <RecipeImage recipeId={version.recipe_id} name={version.document.name} size="small"/>
          <div className="bake-overview-copy"><strong>{version.document.name}</strong><small>{item.completed.length} of {count} steps</small>
            <div className="bake-progress-track"><span style={{width: (count ? item.completed.length / count * 100 : 0) + "%"}}/></div></div>
          <div className="actions">{active && item.completed.length < count && <Button tone="secondary" onClick={() => setFocus(version.id)}>Continue</Button>}
            {active && item.completed.length > 0 && <Button tone="ghost" onClick={() => undo(version.id)}>Undo</Button>}</div>
        </div>;
      })}
    </section>}
    {view === "finish" && <section className="stack"><h2>Wrap up your bake</h2>
      <p className="muted">Keep a record of what worked and what you would change next time.</p>
      {session.recipes.map((item) => {
        const version = versions.find((v) => v.id === item.versionId);
        if (!version) return null;
        const feedback = session.feedback[version.id];
        return <div className="panel stack compact" key={version.id}>
          <h3>{version.document.name}</h3>
          <Field label="Tasting and baking notes"><textarea key={version.id + (feedback?.notes ?? "")}
            defaultValue={noteDraft[version.id] ?? feedback?.notes ?? ""} placeholder="Appearance, texture, flavor, what to adjust..."
            disabled={!active} onBlur={(e) => {
              const value = e.target.value;
              if (value === (feedback?.notes ?? "")) return;
              setNoteDraft((current) => ({ ...current, [version.id]: value }));
              save({ feedback: { ...session.feedback, [version.id]: {
                notes: value, worked: feedback?.worked ?? "", change: feedback?.change ?? "", again: feedback?.again ?? ""
              } } });
            }}/></Field>
        </div>;
      })}
      <div className="actions"><Button tone="secondary" onClick={photos}>Open photos</Button>
        {active && (allDone ? <Button onClick={() => setConfirmFinish(true)}>Complete baking session</Button> :
          <Button onClick={() => setView("steps")}>Return to unfinished steps</Button>)}
      </div>
      {confirmFinish && <div className="panel stack"><p>Mark this baking session complete? Active timers will be dismissed.</p>
        <div className="actions"><Button onClick={finish}>Yes, finish session</Button>
          <Button tone="ghost" onClick={() => setConfirmFinish(false)}>Keep baking</Button></div></div>}
      {!active && <p className="notice success">Baking session completed. Your notes and progress are saved.</p>}
    </section>}
    <p className="bake-footnote">Progress saves to your kitchen workspace. You can leave and reopen this session at any time.</p>
  </div>;
}
