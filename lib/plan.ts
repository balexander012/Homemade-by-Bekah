import { addDays, easternTimeExists, formatAmount, occurs, sharedIngredients, type Doc, type Entry, type Version } from "./domain";

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

export function plannedBakes(events: Entry<"event">[], versions: Version[], sessions: Entry<"session">[], day: string) {
  const scheduled = upcoming(events, day, 1).filter(({ entry }) => entry.document.status === "Scheduled");
  const planned = scheduled.flatMap(({ entry }) => eventRecipes(entry.document, versions).map((selection) => ({
    ...selection,
    eventId: entry.id,
    eventTitle: entry.document.title,
    start: entry.document.start,
    timeNeedsReview: Boolean((entry.document.start && !easternTimeExists(day, entry.document.start)) ||
      (entry.document.end && !easternTimeExists(day, entry.document.end))),
  })));
  return {
    recipes: planned.map(({ version, target, eventId, eventTitle, start, timeNeedsReview }) => {
      const history = sessions.filter((item) => item.document.date <= day).sort((a, b) => b.document.date.localeCompare(a.document.date));
      const notes = history.flatMap((item) => Object.entries(item.document.feedback)).find(([id, feedback]) =>
        versions.some((candidate) => candidate.id === id && candidate.recipe_id === version.recipe_id) && (feedback.change || feedback.notes));
      return {
        versionId: version.id, eventId, eventTitle, start, timeNeedsReview, name: version.document.name, target,
        originalYield: version.document.yieldLow, yieldUnit: version.document.yieldUnit,
        oven: [...new Set(version.document.steps.flatMap((step) => step.temperature ? [step.temperature] : []))],
        photo: scheduled.some(({ entry }) => entry.id === eventId && entry.document.category === "Product photography"),
        previousNote: notes?.[1].change || notes?.[1].notes || "",
      };
    }),
    ingredients: sharedIngredients(planned, versions).map((row) => ({
      key: row.key, name: row.name, preparation: row.preparation, amount: row.total ? formatAmount(row.total) : "Check amount",
      allocations: row.allocations.map(({ recipe, measurement }) => ({ recipe, amount: formatAmount(measurement) })),
    })),
    equipment: [...new Set(planned.flatMap(({ version }) => version.document.equipment))],
  };
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
