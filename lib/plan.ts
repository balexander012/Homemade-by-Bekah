import { addDays, occurs, type Doc, type Entry, type Version } from "./domain";

export function eventRecipes(event: Doc<"event">, versions: Version[]) {
  return event.recipes.flatMap((selection) => {
    const version = versions.find((item) => item.id === selection.versionId);
    return version ? [{ ...selection, version }] : [];
  });
}

export function upcoming(events: Entry<"event">[], from: string, days: number) {
  return Array.from({ length: days }, (_, offset) => addDays(from, offset)).flatMap((day) =>
    events.filter(({ document }) => occurs(document, day))
      .sort((a, b) => (a.document.start ?? "").localeCompare(b.document.start ?? "") || a.document.title.localeCompare(b.document.title))
      .map((entry) => ({ day, entry })));
}

export function generatedTasks(events: Entry<"event">[], versions: Version[], from: string, days: number) {
  return upcoming(events, from, days + 365).flatMap(({ day, entry }) => {
    if (entry.document.status !== "Scheduled") return [];
    const recipes = eventRecipes(entry.document, versions);
    const rows = recipes.flatMap(({ version }) => version.document.prep.map((task, index) => ({
      key: `${version.id}:${index}`, title: `${task.title} · ${version.document.name}`.slice(0, 200), offset: task.daysBefore,
    })));
    if (recipes.some(({ version }) => version.document.ingredients.length > 0)) rows.push({ key: "ingredients", title: "Check ingredient availability", offset: 0 });
    if (recipes.some(({ version }) => version.document.equipment.length > 0)) rows.push({ key: "equipment", title: "Set out the baking equipment", offset: 0 });
    if (entry.document.category === "Product photography") rows.push({ key: "camera", title: "Prepare the camera and photo surface", offset: 0 });
    if (entry.document.prepDeadline) {
      const offset = (Date.parse(entry.document.date) - Date.parse(entry.document.prepDeadline)) / 86400000;
      if (offset <= 365) rows.push({ key: "deadline", title: "Finish preparation", offset });
    }
    const occurrence = entry.document.recurrence === "None" ? undefined : day;
    return rows.map((row) => ({
      key: [entry.id, occurrence ?? "single", row.key].join(":"),
      document: {
        title: row.title, date: addDays(day, -row.offset), status: "Open", section: "Preparation",
        eventId: entry.id, occurrence, offset: row.offset,
      } satisfies Doc<"task">,
    })).filter((row) => row.document.date >= from && row.document.date < addDays(from, days));
  });
}

export async function taskId(key: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).slice(0, 16);
  digest[6] = (digest[6] & 15) | 128;
  digest[8] = (digest[8] & 63) | 128;
  const value = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join("-");
}

export async function planTasks(events: Entry<"event">[], tasks: Entry<"task">[], versions: Version[], from: string, days: number) {
  const generated = await Promise.all(generatedTasks(events, versions, from, days).map(async (row) => ({
    id: await taskId(row.key), kind: "task" as const, revision: 0, document: row.document,
  })));
  const saved = new Map(tasks.map((entry) => [entry.id, entry]));
  return [
    ...generated.filter((row) => !saved.has(row.id)),
    ...tasks.flatMap((row) => {
      const { eventId, occurrence, offset } = row.document;
      if (!eventId) return [row];
      const event = events.find(({ id }) => eventId === id)?.document;
      if (!event || event.status === "Cancelled" || (occurrence && !occurs(event, occurrence))) return [];
      return offset === undefined ? [row] : [{ ...row, document: { ...row.document, date: addDays(occurrence ?? event.date, -offset) } }];
    }),
  ].filter((row) => row.document.date < addDays(from, days));
}
