"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { activeVersions, addDays, dateLabel, easternTimeExists, eventCategories, isLaunchCheckSession, nextStep, occurs, timerTime, type Doc, type Entry, type Selection, type Version } from "@/lib/domain";
import { eventRecipes, plannedBakes, planTasks, upcoming } from "@/lib/plan";
import { recordsOf } from "@/lib/store";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, Status, message } from "./ui";
import { RecipeImage } from "./recipe-photos";

export function RecipePicker({ versions, selected, onChange, empty }: { versions: Version[]; selected: Selection[]; onChange: (value: Selection[]) => void; empty?: ReactNode }) {
  return <fieldset className="stack"><legend className="mb-2"><h2>Choose recipes</h2></legend>
    {!versions.length && (empty ?? <p className="muted">No recipes are available for this action.</p>)}
    <div className="pick-list">{versions.map((version) => {
      const item = selected.find((row) => row.versionId === version.id);
      return <div className="pick" key={version.id}>
        <RecipeImage recipeId={version.recipe_id} name={version.document.name} size="small" />
        <label className="check"><input type="checkbox" aria-label={version.document.name} checked={Boolean(item)} onChange={(event) => onChange(event.target.checked ?
          [...selected, { versionId: version.id, target: null }] : selected.filter((row) => row.versionId !== version.id))} />
          <span><strong>{version.document.name}</strong><br /><span className="muted">{version.document.category}{version.document.yieldLow ? ` · makes ${version.document.yieldLow} ${version.document.yieldUnit}` : ""}</span></span></label>
        {item && <Field label={`Target for ${version.document.name}`}><input type="number" inputMode="decimal" min="0.01" max="100000" step="any" placeholder={version.document.yieldLow?.toString() ?? "Original yield"}
          value={item.target ?? ""} onChange={(event) => onChange(selected.map((row) => row.versionId === version.id ?
            { ...row, target: event.target.value ? Number(event.target.value) : null } : row))} /></Field>}
      </div>;
    })}</div>
  </fieldset>;
}

export function EventCard({ entry, day, store, edit, start, showNotes = true, compact = false, resume }: {
  entry: Entry<"event">; day: string; store: WorkspaceStore; edit: () => void; start: () => void;
  showNotes?: boolean; compact?: boolean; resume?: () => void;
}) {
  const event = entry.document;
  const { versions, approvals } = store.library;
  const recipes = eventRecipes(event, versions);
  // Offer, never force, the newer preferred version. Saving goes through the normal revision-checked queue.
  const newer = event.status === "Scheduled" || event.status === "Draft" ? event.recipes.flatMap((row) => {
    const assigned = versions.find((item) => item.id === row.versionId);
    const preferred = assigned && approvals[assigned.recipe_id];
    return assigned && preferred && preferred !== assigned.id && !event.recipes.some((other) => other.versionId === preferred) ?
      [{ from: row.versionId, to: preferred, name: versions.find((item) => item.id === preferred)?.document.name ?? assigned.document.name }] : [];
  }) : [];
  const upgrade = () => store.put("event", { ...event, recipes: event.recipes.map((row) => {
    const change = newer.find((item) => item.from === row.versionId);
    return change ? { ...row, versionId: change.to } : row;
  }) }, entry.id);
  return <article className={"panel stack compact event-card" + (compact ? " today-event-card" : "")} style={categoryColor(event.category)}>
    <div className="line"><p className="eyebrow">{event.start ? event.start + (event.end ? " to " + event.end : "") + " · " : ""}{event.category}</p>
      <Status>{resume ? "In progress" : event.status}</Status></div>
    <h3 title={event.title}>{event.title}</h3>
    {event.recurrence !== "None" && <p className="muted">{event.recurrence} · {dateLabel(day, { month: "short", day: "numeric" })}</p>}
    {((event.start && !easternTimeExists(day, event.start)) || (event.end && !easternTimeExists(day, event.end))) &&
      <p className="warning">This time falls in the daylight saving clock change. Confirm a time for this date.</p>}
    {compact ? (recipes.length > 0 && <details className="today-event-recipes"><summary>{recipes.length} recipe{recipes.length === 1 ? "" : "s"} · View details</summary>
      <ul>{recipes.map(({ version, target }) => <li key={version.id}>{version.document.name}{target ? " · " + target + " " + version.document.yieldUnit : ""}</li>)}</ul>
    </details>) : (recipes.length > 0 && <ul>{recipes.map(({ version, target }) =>
      <li key={version.id}>{version.document.name}{target ? " · " + target + " " + version.document.yieldUnit : ""}</li>)}</ul>)}
    {showNotes && event.notes && <details className="event-notes"><summary>Notes</summary><p className="muted whitespace-pre-wrap">{event.notes}</p></details>}
    {newer.length > 0 && (compact ? <details className="today-version-update"><summary>Newer recipe version available</summary>
      <p className="muted">{newer.map((item) => item.name).join(", ")}</p>
      <Button tone="secondary" onClick={upgrade}>Use newer version for this event</Button>
      {resume && <p className="muted">The active baking session keeps its current recipe version.</p>}
    </details> : <div className="notice stack compact"><p>Newer recipe version: {newer.map((item) => item.name).join(", ")}.</p>
      <div className="actions"><Button tone="secondary" onClick={upgrade}>Use the newer version</Button></div></div>)}
    <div className="actions"><Button tone="secondary" onClick={edit}>Edit event</Button>
      {resume ? <Button onClick={resume}>Resume session</Button> : event.status === "Scheduled" && <Button onClick={start}>Start baking</Button>}</div>
  </article>;
}

const views = ["Month", "Week", "Day"] as const;
const categoryToken: Record<string, string> = {
  "Personal baking": "baking", "Recipe testing": "testing", "Product photography": "photo", "Customer order production": "order",
  "Ingredient shopping": "shopping", "Packaging preparation": "packaging", "Content creation": "content", "General business tasks": "business",
};
export const categoryColor = (category: string) => ({ "--cat": `var(--cal-${categoryToken[category] ?? "baking"})` }) as CSSProperties;
function weekStart(day: string) { return addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay()); }

export function Calendar({ day, setDay, today, store, edit, start }: {
  day: string; setDay: (day: string) => void; today: string; store: WorkspaceStore;
  edit: (date: string, event?: Entry<"event">) => void; start: (date: string, event: Entry<"event">) => void;
}) {
  const [view, setView] = useState<typeof views[number]>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "Day" : "Week");
  const events = recordsOf(store.records, "event");
  const first = `${day.slice(0, 7)}-01`;
  const days = view === "Day" ? [day] : Array.from({ length: view === "Week" ? 7 : 42 }, (_, index) => addDays(weekStart(view === "Week" ? day : first), index));
  const visible = view === "Month" && days.slice(35).every((date) => date.slice(0, 7) !== day.slice(0, 7)) ? days.slice(0, 35) : days;
  function move(direction: number) {
    if (view === "Month") {
      const month = new Date(`${first}T12:00:00Z`);
      month.setUTCMonth(month.getUTCMonth() + direction);
      setDay(month.toISOString().slice(0, 10));
    } else setDay(addDays(day, view === "Week" ? direction * 7 : direction));
  }
  const title = view === "Month" ? dateLabel(day, { year: "numeric", month: "long" }) : view === "Week" ?
    `${dateLabel(days[0], { month: "short", day: "numeric" })} – ${dateLabel(days[6], { month: "short", day: "numeric" })}` : dateLabel(day, { weekday: "long", month: "long", day: "numeric" });
  const limit = view === "Week" ? 6 : 2;
  return <><Heading title="Calendar"><Button onClick={() => edit(day)}><Plus size={20} /> Add event</Button></Heading>
    <div className="stack">
      <section className="panel stack">
        <div className="line">
          <div className="segmented" role="group" aria-label="Calendar view">{views.map((name) =>
            <button type="button" key={name} aria-pressed={view === name} onClick={() => setView(name)}>{name}</button>)}</div>
          <div className="date-nav">
            <Button tone="secondary" aria-label={`Previous ${view.toLowerCase()}`} onClick={() => move(-1)}><ChevronLeft /></Button>
            <Button tone="secondary" onClick={() => setDay(today)}>Today</Button>
            <Button tone="secondary" aria-label={`Next ${view.toLowerCase()}`} onClick={() => move(1)}><ChevronRight /></Button>
          </div>
        </div>
        <div className="date-nav"><h2>{title}</h2></div>
        {view !== "Day" && <div className={`calendar-grid ${view === "Week" ? "week" : ""}`}>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <span key={label}>{label}</span>)}
          {visible.map((date) => {
            const items = events.filter(({ document }) => occurs(document, date));
            const outside = view === "Month" && date.slice(0, 7) !== day.slice(0, 7);
            const classes = [outside ? "muted" : "", date === today ? "is-today" : "", date < today ? "is-past" : ""].filter(Boolean).join(" ");
            return <button key={date} type="button" className={classes || undefined} aria-pressed={date === day}
              aria-label={`${dateLabel(date)}${items.length ? `, ${items.length} events` : ""}`} onClick={() => setDay(date)}>
              <span className="date-num">{Number(date.slice(8))}</span>
              {items.slice(0, limit).map(({ id, document }) => <span key={id} className={`cal-bar ${document.status === "Draft" ? "draft" : ""}`}
                style={categoryColor(document.category)} aria-hidden="true">{document.start ? `${document.start} ` : ""}{document.title}</span>)}
              {items.length > limit && <span className="cal-more" aria-hidden="true">+{items.length - limit} more</span>}
              {items.length > 0 && <span className="cal-dot" style={{ background: `var(--cal-${categoryToken[items[0].document.category] ?? "baking"})` }} aria-hidden="true" />}
            </button>;
          })}
        </div>}
      </section>
      <section className="stack"><h2>{dateLabel(day)}</h2>
        {upcoming(events, day, 1).map(({ entry }) => <EventCard key={entry.id} entry={entry} day={day} store={store} edit={() => edit(day, entry)} start={() => start(day, entry)} />)}
        {!upcoming(events, day, 1).length && <div className="panel empty-state"><p className="muted">Nothing scheduled for this date.</p>
          <Button tone="secondary" onClick={() => edit(day)}><Plus size={20} /> Add event for this day</Button></div>}
      </section>
    </div>
  </>;
}

export function EventEditor({ day, entry, initialTitle, store, close }: {
  day: string; entry?: Entry<"event">; initialTitle?: string; store: WorkspaceStore; close: (day: string, saved?: boolean) => void;
}) {
  const [event, setEvent] = useState<Doc<"event">>(() => entry?.document ?? {
    title: initialTitle ?? "", date: day, category: "Personal baking", status: "Scheduled", recipes: [], notes: "", recurrence: "None", excludedDates: [],
  });
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const patch = (value: Partial<Doc<"event">>) => setEvent((previous) => ({ ...previous, ...value }));
  const versions = [...activeVersions(store.library), ...store.library.versions.filter((version) =>
    event.recipes.some((item) => item.versionId === version.id) && !activeVersions(store.library).some((item) => item.id === version.id))];
  function save(value: Doc<"event">) {
    try {
      store.put("event", value, entry?.id);
      close(value.date, true);
    } catch (cause) { setError(message(cause)); }
  }
  const isSeries = Boolean(entry && entry.document.recurrence !== "None");
  return <><Heading title={entry ? "Edit event" : "Add event"} detail={isSeries ? "Changes apply to the recurring series" : undefined} />
    <form className="stack" onSubmit={(native: FormEvent) => { native.preventDefault(); save(event); }}>
      <section className="panel stack">
        <Field label="Event title"><input required value={event.title} onChange={(e) => patch({ title: e.target.value })} /></Field>
        <div className="cols">
          <Field label="Event date"><input type="date" required value={event.date} onChange={(e) => patch({ date: e.target.value })} /></Field>
          <Field label="Event category"><select value={event.category} onChange={(e) => patch({ category: e.target.value as typeof event.category })}>{eventCategories.map((name) => <option key={name}>{name}</option>)}</select></Field>
          <Field label="Start time (optional)"><input type="time" value={event.start ?? ""} onChange={(e) => patch({ start: e.target.value || undefined })} /></Field>
          <Field label="End time (optional)"><input type="time" value={event.end ?? ""} onChange={(e) => patch({ end: e.target.value || undefined })} /></Field>
          <Field label="Repeat"><select value={event.recurrence} onChange={(e) => patch({ recurrence: e.target.value as typeof event.recurrence, until: undefined })}>{["None", "Weekly", "Monthly"].map((name) => <option key={name}>{name}</option>)}</select></Field>
          {event.recurrence !== "None" && <Field label="Repeat through"><input type="date" required value={event.until ?? ""} onChange={(e) => patch({ until: e.target.value || undefined })} /></Field>}
          <Field label="Preparation deadline"><input type="date" value={event.prepDeadline ?? ""} onChange={(e) => patch({ prepDeadline: e.target.value || undefined })} /></Field>
          <Field label="Event status"><select value={event.status} onChange={(e) => patch({ status: e.target.value as typeof event.status })}>{["Draft", "Scheduled", "Completed", "Cancelled"].map((name) => <option key={name}>{name}</option>)}</select></Field>
        </div>
        <Field label="Event notes"><textarea value={event.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>
      </section>
      <section className="panel"><RecipePicker versions={versions} selected={event.recipes} onChange={(recipes) => patch({ recipes })} /></section>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="actions"><Button type="submit">Save event</Button><Button tone="ghost" onClick={() => close(day)}>Back to calendar</Button>
        {entry && <Button tone="ghost" onClick={() => setCancelling(true)}>Cancel event</Button>}</div>
      {cancelling && <section className="panel stack"><p>Remove this event from the calendar?</p><div className="actions">
        {isSeries && <Button tone="secondary" onClick={() => save({ ...entry!.document, excludedDates: [...new Set([...entry!.document.excludedDates, day])] })}>Cancel this date</Button>}
        <Button onClick={() => save({ ...entry!.document, status: "Cancelled" })}>{isSeries ? "Cancel series" : "Confirm cancellation"}</Button>
        <Button tone="ghost" onClick={() => setCancelling(false)}>Keep event</Button>
      </div></section>}
    </form>
  </>;
}

function TaskRow({ task, store }: { task: Entry<"task">; store: WorkspaceStore }) {
  const [date, setDate] = useState(task.document.date);
  const [title, setTitle] = useState(task.document.title);
  const [edit, setEdit] = useState(false);
  return <div className={"today-task" + (task.document.status === "Done" ? " is-done" : "")}>
    <div className="today-task-main">
      <label className="check"><input type="checkbox" checked={task.document.status === "Done"}
        onChange={(e) => store.put("task", { ...task.document, status: e.target.checked ? "Done" : "Open" }, task.id)} />
        <span>{task.document.title}</span></label>
      <Button tone="ghost" className="today-task-edit" onClick={() => {
        setTitle(task.document.title);
        setDate(task.document.date);
        setEdit(!edit);
      }}>{edit ? "Close" : "Edit task"}</Button>
    </div>
    {edit && <form className="today-task-editor stack compact" onSubmit={(e) => {
      e.preventDefault(); store.put("task", { ...task.document, title, date, offset: undefined }, task.id); setEdit(false);
    }}>
      <Field label="Task title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Task date"><input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="actions"><Button type="submit">Save task</Button>
        <Button tone="ghost" onClick={() => { store.put("task", { ...task.document, status: "Dismissed" }, task.id); setEdit(false); }}>Dismiss task</Button>
      </div>
    </form>}
  </div>;
}

export function Today({ today, now, store, edit, start, resume, showCalendar, showPhotos, showRecipes }: {
  today: string; now: number; store: WorkspaceStore; edit: (date: string, event?: Entry<"event">) => void;
  start: (date: string, event?: Entry<"event">) => void; resume: (id: string) => void;
  showCalendar: (date: string) => void; showPhotos: () => void; showRecipes: () => void;
}) {
  const [tasks, setTasks] = useState<Entry<"task">[]>([]);
  const [adding, setAdding] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<Doc<"task">["section"]>("Preparation");
  const records = store.records;
  const versions = store.library.versions;
  const events = recordsOf(records, "event");
  const sessions = recordsOf(records, "session").filter((item) => !isLaunchCheckSession(item.document.title));
  const active = sessions.filter(({ document }) => document.status === "Active");
  const scheduled = upcoming(events, today, 1).filter(({ entry }) => entry.document.status !== "Cancelled");
  const bakes = useMemo(() => plannedBakes(events, versions, sessions, today), [events, versions, sessions, today]);
  const coming = upcoming(events, addDays(today, 1), 14)
    .filter(({ entry }) => entry.document.status !== "Cancelled");
  useEffect(() => {
    let cancelled = false;
    void planTasks(recordsOf(records, "event"), recordsOf(records, "task"), versions, today, 2).then((rows) => {
      if (!cancelled) setTasks(rows);
    });
    return () => { cancelled = true; };
  }, [records, today, versions]);
  const visibleTasks = tasks.filter((row) => row.document.status !== "Dismissed");
  const marked = visibleTasks.filter((row) => row.document.date === today ||
    (row.document.date < today && row.document.status === "Open"));
  const pending = marked.filter(({ document }) => document.status === "Open");
  const done = marked.filter(({ document }) => document.status === "Done");
  const tomorrow = visibleTasks.filter((row) => row.document.date === addDays(today, 1));
  const dismissed = tasks.filter((task) => task.document.status === "Dismissed" && task.document.date >= today);
  const sections = ["Preparation", "Baking", "Photography", "Wrap Up"] as const;
  const hasPrep = bakes.ingredients.length > 0 || bakes.equipment.length > 0;
  const quiet = active.length === 0 && scheduled.length === 0 && pending.length === 0;
  const addTask = adding && <form className="today-new-task" onSubmit={(e) => {
    e.preventDefault(); store.put("task", { title, date: today, section, status: "Open" }); setTitle(""); setAdding(false);
  }}>
    <Field label="Task title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field label="Section"><select value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
      {sections.map((name) => <option key={name}>{name}</option>)}</select></Field>
    <div className="actions"><Button type="submit">Save task</Button>
      <Button tone="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
  </form>;
  return <div className="today-page">
    <Heading title="Today’s Plan" detail={dateLabel(today)}>
      <div className="actions today-page-actions">
        <Button tone="secondary" onClick={() => edit(today)}><Plus size={17} /> Add event</Button>
        <Button tone="ghost" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add task"}</Button>
      </div>
    </Heading>
    {adding && <section className="panel stack compact today-task-add"><h2>New task</h2>{addTask}</section>}
    {quiet ? <section className="today-quiet">
      <h2>Nothing urgent today</h2>
      <p className="muted">Plan a baking session or choose a recipe to work on.</p>
      <div className="actions"><Button onClick={() => edit(today)}>Plan a bake</Button>
        <Button tone="secondary" onClick={showRecipes}>Browse recipes</Button></div>
    </section> : <>
      {active.length > 0 && <section className="today-live-section" aria-label="Active baking sessions">
        <div className="today-section-heading"><h2>In the kitchen</h2>
          <span className="today-section-count">{active.length} active</span></div>
        <div className="today-live-list">{active.map((entry) => {
          const total = entry.document.recipes.reduce((count, row) =>
            count + (versions.find((version) => version.id === row.versionId)?.document.steps.length ?? 0), 0);
          const completed = entry.document.recipes.reduce((count, row) => count + row.completed.length, 0);
          const step = nextStep(entry.document, versions, now);
          const timers = entry.document.timers.filter((timer) => !timer.cancelled).sort((a, b) => a.deadline - b.deadline);
          const first = timers[0];
          return <article className="today-live-card" key={entry.id}>
            <div className="today-live-main">
              <p className="eyebrow">Baking in progress</p>
              <h3 title={entry.document.title}>{entry.document.title}</h3>
              <div className="today-live-progress">
                <span>{completed} of {total} steps complete</span><span>{total ? Math.round(completed / total * 100) : 0}%</span>
              </div>
              <div className="today-progress-track" role="progressbar" aria-valuenow={completed}
                aria-valuemin={0} aria-valuemax={total || 1} aria-label={"Progress for " + entry.document.title}>
                <span style={{ width: (total ? completed / total * 100 : 0) + "%" }} /></div>
              {step && <p className="today-live-next"><strong>Next:</strong> {step.version.document.name} · {step.step.instruction}</p>}
              {first && <p className={"today-live-timer" + (first.deadline <= now ? " is-due" : "")}>
                {first.deadline <= now ? "Timer overdue" : "Timer running"} · {first.label} · {timerTime(first.deadline - now)}
              </p>}
            </div>
            <Button onClick={() => resume(entry.id)}>Resume baking <ChevronRight size={18} /></Button>
          </article>;
        })}</div>
      </section>}
      <div className="today-content-grid">
        <section className="today-schedule-section stack compact" aria-label="Today's schedule">
          <div className="today-section-heading"><h2>Today’s schedule</h2>
            <button type="button" className="today-text-link" onClick={() => showCalendar(today)}>Open planner <ChevronRight size={15}/></button></div>
          {scheduled.length > 0 ? <div className="today-event-list">
            {scheduled.map(({ entry, day }) => {
              const running = active.find((item) => item.document.eventId === entry.id && item.document.date === day);
              return <EventCard key={entry.id + ":" + day} entry={entry} day={day} store={store} compact showNotes={false}
                edit={() => edit(day, entry)} start={() => start(day, entry)}
                resume={running ? () => resume(running.id) : undefined} />;
            })}
          </div> : <div className="today-schedule-empty">
            <CalendarDays size={18}/><span>Nothing scheduled today.</span>
            <Button tone="ghost" onClick={() => edit(today)}>Add an event</Button>
          </div>}
        </section>
        <section className="today-todos panel stack compact" aria-label="Today's checklist">
          <div className="today-section-heading"><h2>To do</h2>
            <span className="today-section-count">{pending.length} left{marked.length ? " · " + done.length + " done" : ""}</span></div>
          {pending.length === 0 && <p className="today-all-done muted">{marked.length ? "All of today's tasks are complete." : "No tasks due today."}</p>}
          {sections.filter((name) => pending.some((task) => task.document.section === name)).map((name) =>
            <div className="today-task-group" key={name}>
              <h3>{name}</h3>
              {pending.filter((task) => task.document.section === name).map((task) =>
                <TaskRow key={task.id} task={task} store={store} />)}
            </div>)}
          {done.length > 0 && <details className="today-done-tasks"><summary>Completed tasks · {done.length}</summary>
            {done.map((task) => <TaskRow key={task.id} task={task} store={store} />)}
          </details>}
          {hasPrep && active.length === 0 && <details className="today-prep-details"><summary>Ingredients and equipment</summary>
            <div className="today-prep-contents">
              {bakes.ingredients.map((item) => <p key={item.key}><strong>{item.amount}</strong> · {item.name}{item.preparation ? " · " + item.preparation : ""}</p>)}
              {bakes.equipment.length > 0 && <p><strong>Equipment:</strong> {bakes.equipment.join(", ")}</p>}
            </div>
          </details>}
        </section>
      </div>
    </>}
    {(tomorrow.length > 0 || dismissed.length > 0 || coming.length > 0) && <section className="today-later panel stack compact">
      <div className="today-section-heading"><h2>Coming up</h2>
        <button type="button" className="today-text-link" onClick={() => showCalendar(today)}>View calendar <ChevronRight size={15}/></button></div>
      {coming.length > 0 && <div className="today-upcoming-list">{coming.slice(0, showAllUpcoming ? 12 : 3).map(({ entry, day }) =>
        <button type="button" key={entry.id + ":" + day} onClick={() => showCalendar(day)}>
          <span>{dateLabel(day, { weekday: "short", month: "short", day: "numeric" })}</span>
          <strong>{entry.document.title}</strong><ChevronRight size={16} aria-hidden="true"/>
        </button>)}</div>}
      {coming.length > 3 && <Button tone="ghost" onClick={() => setShowAllUpcoming(!showAllUpcoming)}>
        {showAllUpcoming ? "Show fewer dates" : "Show more dates"}</Button>}
      {tomorrow.length > 0 && <details className="today-later-details"><summary>Tomorrow’s tasks · {tomorrow.length}</summary>
        {tomorrow.map((task) => <TaskRow key={task.id} task={task} store={store} />)}
      </details>}
      {dismissed.length > 0 && <details className="today-later-details"><summary>Dismissed tasks · {dismissed.length}</summary>
        {dismissed.map((task) => <div className="today-dismissed-task" key={task.id}>
          <span>{task.document.title}</span>
          <Button tone="ghost" onClick={() => store.put("task", { ...task.document, status: "Open" }, task.id)}>Restore</Button>
        </div>)}
      </details>}
    </section>}
  </div>;
}
