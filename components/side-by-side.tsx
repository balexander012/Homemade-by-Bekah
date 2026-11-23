"use client";

import { useState } from "react";
import { Check, Clock3, RotateCcw, Timer, Volume2 } from "lucide-react";
import {
  currentSteps, formatAmount, ovenBlocked, scale, timerTime,
  type Session, type Version,
} from "@/lib/domain";
import { Button, Field } from "./ui";

type CurrentRow = ReturnType<typeof currentSteps>[number];

export function SideBySideSteps({ session, versions, now, active, sound, save }: {
  session: Session;
  versions: Version[];
  now: number;
  active: boolean;
  sound: () => void;
  save: (patch: Partial<Session>) => void;
}) {
  const [timerOpen, setTimerOpen] = useState<string | null>(null);
  const [timerMinutes, setTimerMinutes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>("");

  const rows = currentSteps(session, versions, now);
  const updateMinutes = (versionId: string, value: string) =>
    setTimerMinutes((values) => ({ ...values, [versionId]: value }));

  const complete = (row: CurrentRow) => {
    if (!active) return;
    const { version, step } = row;
    save({
      recipes: session.recipes.map((recipe) => recipe.versionId === version.id
        ? { ...recipe, completed: recipe.completed.includes(step.id) ? recipe.completed : [...recipe.completed, step.id] }
        : recipe),
      timers: session.timers.map((timer) => timer.versionId === version.id && timer.stepId === step.id
        ? { ...timer, cancelled: true } : timer),
      focusVersionId: version.id,
    });
    setTimerOpen(null);
    setError("");
  };

  const undo = (versionId: string) => {
    if (!active) return;
    save({
      recipes: session.recipes.map((recipe) => recipe.versionId === versionId && recipe.completed.length
        ? { ...recipe, completed: recipe.completed.slice(0, -1) }
        : recipe),
      focusVersionId: versionId,
    });
    setError("");
  };

  const startTimer = (row: CurrentRow) => {
    const { version, step } = row;
    const minutes = Number(timerMinutes[version.id] || step.minutes || 0);
    if (!Number.isFinite(minutes) || minutes < 0.01 || minutes > 10080) {
      setError("Enter a timer between 0.01 and 10,080 minutes.");
      return;
    }
    const started = Date.now();
    sound();
    save({
      timers: [...session.timers, {
        id: crypto.randomUUID(),
        versionId: version.id, stepId: step.id,
        label: (version.document.name + " · Step " + (version.document.steps.indexOf(step) + 1)).slice(0, 200),
        start: started, deadline: started + Math.round(minutes * 60000), cancelled: false,
      }],
    });
    setTimerOpen(null);
    setError("");
    updateMinutes(version.id, "");
  };

  const speak = (row: CurrentRow) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const amounts = row.version.document.ingredients.filter((ingredient) =>
      row.step.ingredients.includes(ingredient.id))
      .map((ingredient) => formatAmount(scale(ingredient, row.version.document, row.progress.target)) +
        " " + ingredient.name).join(". ");
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(row.step.instruction + ". " + amounts));
  };

  return <div className="bake-side-workspace">
    <p className="bake-side-hint">Both recipes stay visible. Each has its own steps, timer, and progress.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="bake-side-grid" aria-label="Side-by-side baking recipes">
      {session.recipes.map((recipe) => {
        const version = versions.find((item) => item.id === recipe.versionId);
        if (!version) return <section className="bake-side-panel" key={recipe.versionId}>
          <div className="panel notice warning">This recipe version is unavailable.</div>
        </section>;
        const row = rows.find((item) => item.version.id === version.id);
        const total = version.document.steps.length;
        const index = row ? version.document.steps.indexOf(row.step) + 1 : total;
        const ingredients = row ? version.document.ingredients.filter((ingredient) => row.step.ingredients.includes(ingredient.id)) : [];
        return <section className="bake-side-panel" key={version.id} aria-label={version.document.name}>
          <article className={"bake-current-step bake-side-step" + (!row ? " bake-side-done" : "")}>
            <div className="bake-step-meta">
              <span className="bake-recipe-name">{version.document.name}</span>
              <span className="bake-step-count">{row ? "Step " + index + " of " + total : "Complete"}</span>
              {row && <span className="bake-kind">{row.step.kind}</span>}
            </div>
            <div className="bake-step-scroll" tabIndex={0} aria-label={version.document.name + " instructions and ingredients"}>
              {row ? <>
                <h2 className="bake-instruction">{row.step.instruction}</h2>
                {(row.step.temperature || row.step.minutes) && <p className="bake-step-specs">
                  {row.step.temperature ? row.step.temperature + " °F" : ""}
                  {row.step.temperature && row.step.minutes ? " · " : ""}
                  {row.step.minutes ? row.step.minutes + " minutes" : ""}
                </p>}
                {row.progress.target && row.step.kind === "Oven" &&
                  <p className="notice warning">Batch size changed. Check pan capacity and baking time.</p>}
                {ovenBlocked(session, rows, row) &&
                  <p className="notice warning">Check oven availability before starting this step.</p>}
                {row.waiting && row.timer &&
                  <p className="bake-waiting"><Clock3 size={18}/> Waiting on timer · {timerTime(row.timer.deadline - now)}</p>}
                {ingredients.length > 0 && <div className="bake-step-ingredients">
                  <h3>For this step</h3>
                  {ingredients.map((ingredient) => {
                    const amount = scale(ingredient, version.document, row.progress.target);
                    return <div className="bake-ingredient" key={ingredient.id}>
                      <span>{ingredient.name}{ingredient.preparation ? " · " + ingredient.preparation : ""}</span>
                      <strong>{formatAmount(amount)}</strong>
                      {amount.warning && <small className="warning">{amount.warning}</small>}
                    </div>;
                  })}
                </div>}
              </> : <div className="bake-recipe-finished">
                <Check size={26} aria-hidden="true"/>
                <h2>Recipe complete</h2>
                <p className="muted">All {total} steps finished. You can undo the last step if needed.</p>
              </div>}
            </div>
            {active && row && <div className="bake-step-tools">
              <Button tone="ghost" onClick={() => speak(row)}><Volume2 size={17}/> Read aloud</Button>
            </div>}
          </article>
          {active && <div className="bake-side-actions" role="group" aria-label={version.document.name + " actions"}>
            {timerOpen === version.id && row && <div className="bake-inline-timer">
              <Field label="Timer minutes"><input type="number" min="0.01" max="10080" step="any"
                inputMode="decimal" placeholder={row.step.minutes ? String(row.step.minutes) : "Minutes"}
                value={timerMinutes[version.id] ?? ""}
                onChange={(event) => updateMinutes(version.id, event.target.value)}/></Field>
              <Button tone="secondary" onClick={() => startTimer(row)}>Start timer</Button>
              <Button tone="ghost" onClick={() => setTimerOpen(null)}>Cancel</Button>
            </div>}
            <div className="bake-side-action-buttons">
              <Button tone="ghost" disabled={!recipe.completed.length} onClick={() => undo(version.id)}>
                <RotateCcw size={16}/> Undo</Button>
              {row && <Button tone="secondary" onClick={() => setTimerOpen(timerOpen === version.id ? null : version.id)}
                aria-expanded={timerOpen === version.id}><Timer size={16}/> Set timer</Button>}
              {row && <Button className="bake-side-complete" onClick={() => complete(row)}>
                Complete step <Check size={17}/></Button>}
            </div>
          </div>}
        </section>;
      })}
    </div>
  </div>;
}
