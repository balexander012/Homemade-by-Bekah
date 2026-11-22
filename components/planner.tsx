"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { activeVersions, addDays, dateLabel, eventCategories, occurs, type Doc, type Entry, type Selection, type Version } from "@/lib/domain";
import { eventRecipes, planTasks, upcoming } from "@/lib/plan";
import { recordsOf } from "@/lib/store";
import type { WorkspaceStore } from "@/lib/use-workspace";
import { Button, Field, Heading, Status, message } from "./ui";

export function RecipePicker({ versions, selected, onChange }: { versions: Version[]; selected: Selection[]; onChange: (value: Selection[]) => void }) {
  return <fieldset className="stack"><legend className="mb-2 font-semibold">Choose recipes</legend>
    {!versions.length && <p className="muted">No recipes are available for this action.</p>}
    {versions.map((version) => {
      const item = selected.find((row) => row.versionId === version.id);
      return <div className="row line" key={version.id}>
        <label className="check"><input type="checkbox" checked={Boolean(item)} onChange={(event) => onChange(event.target.checked ?
          [...selected, { versionId: version.id, target: null }] : selected.filter((row) => row.versionId !== version.id))} />
          <span>{version.document.name}</span></label>
        {item && <Field label={`Target for ${version.document.name}`}><input type="number" min="0.01" max="100000" step="any" placeholder={version.document.yieldLow?.toString() ?? "Original yield"}
          value={item.target ?? ""} onChange={(event) => onChange(selected.map((row) => row.versionId === version.id ?
            { ...row, target: event.target.value ? Number(event.target.value) : null } : row))} /></Field>}
      </div>;
    })}
  </fieldset>;
}

export function EventCard({ entry, day, versions, edit, start }: {
  entry: Entry<"event">; day: string; versions: Version[]; edit: () => void; start: () => void;
}) {
  const event = entry.document;
  const recipes = eventRecipes(event, versions);
  return <article className="panel stack compact">
    <div className="line"><p className="eyebrow">{event.start ? `${event.start}${event.end ? `–${event.end}` : ""} · ${event.category}` : event.category}</p><Status>{event.status}</Status></div>
    <h3>{event.title}</h3>
    {event.recurrence !== "None" && <p className="muted">{event.recurrence} · {dateLabel(day, { month: "short", day: "numeric" })}</p>}
    {recipes.length > 0 && <ul>{recipes.map(({ version, target }) => <li key={version.id}>{version.document.name}{target ? ` · ${target} ${version.document.yieldUnit}` : ""}</li>)}</ul>}
    {event.notes && <p className="muted whitespace-pre-wrap">{event.notes}</p>}
    <div className="actions"><Button tone="secondary" onClick={edit}>Edit event</Button>
      {event.status === "Scheduled" && <Button onClick={start}>Start baking</Button>}</div>
  </article>;
}

const views = ["Month", "Week", "Day"] as const;
function weekStart(day: string) { return addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay()); }

export function Calendar({ day, setDay, today, store, edit, start }: {
  day: string; setDay: (day: string) => void; today: string; store: WorkspaceStore;
  edit: (date: string, event?: Entry<"event">) => void; start: (date: string, event: Entry<"event">) => void;
}) {
  const [view, setView] = useState<typeof views[number]>("Month");
  const events = recordsOf(store.records, "event");
  const first = `${day.slice(0, 7)}-01`;
  const days = view === "Day" ? [day] : Array.from({ length: view === "Week" ? 7 : 42 }, (_, index) => addDays(weekStart(view === "Week" ? day : first), index));
  function move(direction: number) {
    if (view === "Month") {
      const month = new Date(`${first}T12:00:00Z`);
      month.setUTCMonth(month.getUTCMonth() + direction);
      setDay(month.toISOString().slice(0, 10));
    } else setDay(addDays(day, view === "Week" ? direction * 7 : direction));
  }
  return <><Heading title="Calendar"><Button onClick={() => edit(day)}><Plus size={20} /> Add event</Button></Heading>
    <div className="stack">
      <section className="panel stack">
        <div className="line"><div className="actions">{views.map((name) => <Button key={name} tone={view === name ? "primary" : "secondary"} aria-pressed={view === name} onClick={() => setView(name)}>{name}</Button>)}</div>
          <Button tone="ghost" onClick={() => setDay(today)}>Today</Button></div>
        <div className="line">
          <Button tone="secondary" aria-label={`Previous ${view.toLowerCase()}`} onClick={() => move(-1)}><ChevronLeft /></Button>
          <h2>{dateLabel(day, view === "Month" ? { year: "numeric", month: "long" } : { month: "long", day: "numeric" })}</h2>
          <Button tone="secondary" aria-label={`Next ${view.toLowerCase()}`} onClick={() => move(1)}><ChevronRight /></Button>
        </div>
        {view !== "Day" && <div className="calendar-grid">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <span key={label}>{label}</span>)}
          {days.map((date) => {
            const count = events.filter(({ document }) => occurs(document, date)).length;
            return <button key={date} type="button" className={date.slice(0, 7) !== day.slice(0, 7) ? "muted" : undefined} aria-pressed={date === day}
              aria-label={`${dateLabel(date)}${count ? `, ${count} events` : ""}`} onClick={() => setDay(date)}>
              <strong>{Number(date.slice(8))}</strong>{count > 0 && <span className="day-count">{count} {count === 1 ? "event" : "events"}</span>}
            </button>;
          })}
        </div>}
      </section>
      <section className="stack"><h2>{dateLabel(day)}</h2>
        {upcoming(events, day, 1).map(({ entry }) => <EventCard key={entry.id} entry={entry} day={day} versions={store.library.versions} edit={() => edit(day, entry)} start={() => start(day, entry)} />)}
        {!upcoming(events, day, 1).length && <p className="panel muted">Nothing scheduled for this date.</p>}
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
  return <div className="row">
    <div className="line">
      <label className="check"><input type="checkbox" checked={task.document.status === "Done"}
        onChange={(e) => store.put("task", { ...task.document, status: e.target.checked ? "Done" : "Open" }, task.id)} /><span>{task.document.title}</span></label>
      <Button tone="ghost" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit task"}</Button>
    </div>
    {edit && <form className="stack" onSubmit={(e) => { e.preventDefault(); store.put("task", { ...task.document, title, date, offset: undefined }, task.id); setEdit(false); }}>
      <Field label="Task title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Task date"><input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="actions"><Button type="submit">Save task</Button><Button tone="ghost" onClick={() => store.put("task", { ...task.document, status: "Dismissed" }, task.id)}>Dismiss task</Button></div>
    </form>}
  </div>;
}

export function Today({ today, store, edit, start, resume, showCalendar, showPhotos }: {
  today: string; store: WorkspaceStore; edit: (date: string, event?: Entry<"event">) => void;
  start: (date: string, event?: Entry<"event">) => void; resume: (id: string) => void;
  showCalendar: (date: string) => void; showPhotos: () => void;
}) {
  const [tasks, setTasks] = useState<Entry<"task">[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<Doc<"task">["section"]>("Preparation");
  const records = store.records;
  const versions = store.library.versions;
  const events = recordsOf(records, "event");
  const sessions = recordsOf(records, "session");
  const active = sessions.filter(({ document }) => document.status === "Active");
  const scheduled = upcoming(events, today, 1);
  const coming = upcoming(events, addDays(today, 1), 14).slice(0, 5);
  useEffect(() => {
    let cancelled = false;
    void planTasks(recordsOf(records, "event"), recordsOf(records, "task"), versions, today, 2).then((rows) => {
      if (!cancelled) setTasks(rows);
    });
    return () => { cancelled = true; };
  }, [records, today, versions]);
  const open = tasks.filter((row) => row.document.status !== "Dismissed");
  const marked = open.filter((row) => row.document.date === today || (row.document.date < today && row.document.status === "Open"));
  const tomorrow = open.filter((row) => row.document.date === addDays(today, 1));
  const next = marked.find((task) => task.document.status === "Open");
  return <>
    <Heading title="Today’s Plan" detail={dateLabel(today)}><Button onClick={() => active.length ? resume(active[0].id) : start(today)}>{active.length ? "Resume baking" : "Start baking"}</Button></Heading>
    <div className="stack">
      {active.length > 0 && <section className="stack"><h2>In the kitchen</h2><div className="tiles">{active.map((entry) => <article key={entry.id} className="panel stack">
        <h3>{entry.document.title}</h3><p className="muted">{entry.document.recipes.length} batches · {entry.document.mode}</p>
        <Button tone="secondary" onClick={() => resume(entry.id)}>Resume session</Button>
      </article>)}</div></section>}
      <div className="cols">
        <div className="stack">
          <section className="panel tinted stack"><h2>Up next</h2>
            {active.length ? <p>Pick up where you left off in {active[0].document.title}.</p> :
              next ? <p>{next.document.title}</p> :
              scheduled.length ? <p>{scheduled[0].entry.document.title}</p> :
              <><p>Your baking schedule is open today.</p><Button tone="secondary" onClick={() => edit(today)}>Plan a bake</Button></>}
          </section>
          <section className="stack"><div className="line"><h2>Today’s schedule</h2><Button tone="ghost" onClick={() => edit(today)}><Plus size={18} /> Add event</Button></div>
            {scheduled.length ? scheduled.map(({ entry, day }) => <EventCard key={entry.id} entry={entry} day={day} versions={versions} edit={() => edit(day, entry)} start={() => start(day, entry)} />) :
              <p className="panel muted"><CalendarDays className="inline mr-2" size={22} /> Nothing on the calendar today.</p>}
          </section>
          <section className="panel stack"><h2>Upcoming baking days</h2>
            {coming.length ? coming.map(({ entry, day }) => <button key={`${entry.id}:${day}`} className="row inline-link" onClick={() => showCalendar(day)}>
              {dateLabel(day, { weekday: "short", month: "short", day: "numeric" })} · {entry.document.title}</button>) : <p className="muted">No events in the next two weeks.</p>}
          </section>
        </div>
        <div className="stack">
          <section className="panel stack"><div className="line"><h2>Checklist</h2><Button tone="ghost" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add task"}</Button></div>
            {adding && <form className="stack" onSubmit={(e) => { e.preventDefault(); store.put("task", { title, date: today, section, status: "Open" }); setTitle(""); setAdding(false); }}>
              <Field label="Task title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Plan section"><select value={section} onChange={(e) => setSection(e.target.value as typeof section)}>{["Preparation", "Baking", "Photography", "Wrap Up"].map((name) => <option key={name}>{name}</option>)}</select></Field>
              <Button type="submit">Save task</Button>
            </form>}
            {["Preparation", "Baking", "Photography", "Wrap Up"].map((name) => <div key={name}><h3>{name}</h3>
              {marked.filter((task) => task.document.section === name).map((task) => <TaskRow key={task.id} store={store} task={task} />)}
              {!marked.some((task) => task.document.section === name) && <p className="muted">Nothing to check off.</p>}
              {name === "Photography" && <Button tone="ghost" onClick={showPhotos}>Open photo queue</Button>}
            </div>)}
          </section>
          <section className="panel stack"><h2>Prepare for tomorrow</h2>
            {tomorrow.length ? tomorrow.map((task) => <TaskRow key={task.id} task={task} store={store} />) : <p className="muted">No preparation due tomorrow.</p>}
          </section>
        </div>
      </div>
    </div>
  </>;
}
