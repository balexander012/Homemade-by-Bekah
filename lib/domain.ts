import Decimal from "decimal.js";
import { z } from "zod";

export const zone = "America/New_York";
export const date = z.iso.date().refine((value) => value >= "1900-01-01" && value < "2200-01-01", "Use a planning date between 1900 and 2199.");
const easternTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});
export function easternTimeExists(day: string, time: string) {
  const utc = Date.parse(`${day}T${time}:00Z`);
  return Number.isFinite(utc) && [4, 5].some((hours) => easternTime.format(utc + hours * 3600000) === time);
}
export const uuid = z.uuid();
const short = z.string().trim().min(1).max(200);
const notes = z.string().max(15000);
const amount = z.number().positive().max(100000);
export const categories = ["Cookies", "Cakes", "Cupcakes and muffins", "Cinnamon rolls and sweet rolls", "Artisan bread", "Sourdough", "Bagels", "Pastries", "Frostings and fillings", "Other baked goods"] as const;
export const eventCategories = ["Personal baking", "Recipe testing", "Product photography", "Customer order production", "Ingredient shopping", "Packaging preparation", "Content creation", "General business tasks"] as const;
export const recipeStatuses = ["Idea", "Draft", "Ready for Testing", "Tested", "Archived"] as const;
export const ideaStatuses = ["Idea", "Researching", "Recipe Needed", "Ready to Test", "Scheduled", "Completed"] as const;
export const shotStatuses = ["Not started", "Captured", "Needs retake", "Approved"] as const;
export const modes = ["Sequential", "Smart Baking", "Side-by-Side"] as const;

export const ingredientSchema = z.object({
  id: uuid, name: short, quantity: amount.nullable(), unit: z.string().max(60),
  preparation: z.string().max(200), gramsPerUnit: amount.optional(),
});
export const stepSchema = z.object({
  id: uuid, instruction: short.or(z.string().trim().min(1).max(3000)), ingredients: z.array(uuid).max(100),
  minutes: amount.max(10080).optional(), kind: z.enum(["Work", "Rest", "Oven", "Cool"]),
  temperature: z.number().int().min(75).max(650).optional(),
});
export const recipeSchema = z.object({
  name: short, category: short, description: notes, source: notes, tags: z.array(short).max(30),
  yieldLow: amount.nullable(), yieldHigh: amount.optional(), yieldUnit: short,
  status: z.enum(recipeStatuses), ingredients: z.array(ingredientSchema).max(100), steps: z.array(stepSchema).max(100),
  equipment: z.array(short).max(30), prep: z.array(z.object({ title: short, daysBefore: z.number().int().min(0).max(30) })).max(30),
  storage: notes, freezer: notes, notes, changeReason: notes, exceptions: z.array(short).max(50), shots: z.array(short).max(25),
}).superRefine((value, context) => {
  if (value.yieldHigh !== undefined && (value.yieldLow === null || value.yieldHigh < value.yieldLow)) {
    context.addIssue({ code: "custom", path: ["yieldHigh"], message: "Enter a valid yield range." });
  }
  const ids = new Set(value.ingredients.map((item) => item.id));
  if (ids.size !== value.ingredients.length || new Set(value.steps.map((step) => step.id)).size !== value.steps.length ||
      value.steps.some((step) => step.ingredients.some((id) => !ids.has(id)))) {
    context.addIssue({ code: "custom", message: "Ingredient and step IDs must be unique and step ingredients must exist." });
  }
  if (["Ready for Testing", "Tested"].includes(value.status) && !canBake(value)) {
    context.addIssue({ code: "custom", message: "Confirm the yield, quantities, instructions, and oven temperatures. Assign each ingredient to its step before testing." });
  }
});

export const selectionSchema = z.object({ versionId: uuid, target: amount.nullable() });
export const eventSchema = z.object({
  title: short, date, start: z.iso.time({ precision: -1 }).optional(), end: z.iso.time({ precision: -1 }).optional(),
  category: z.enum(eventCategories), status: z.enum(["Draft", "Scheduled", "Cancelled", "Completed"]),
  recipes: z.array(selectionSchema).max(20), notes, recurrence: z.enum(["None", "Weekly", "Monthly"]),
  until: date.optional(), prepDeadline: date.optional(), excludedDates: z.array(date).max(365).default([]),
}).refine((event) => (!event.end || Boolean(event.start && event.end > event.start)) &&
  (!event.until || event.until >= event.date) && (event.recurrence === "None" || Boolean(event.until)) &&
  (!event.prepDeadline || (event.prepDeadline <= event.date && (Date.parse(event.date) - Date.parse(event.prepDeadline)) / 86400000 <= 365)) &&
  (!event.start || easternTimeExists(event.date, event.start)) && (!event.end || easternTimeExists(event.date, event.end)) &&
  new Set(event.recipes.map((recipe) => recipe.versionId)).size === event.recipes.length,
{ message: "Check the event times in New York, preparation deadline, recurrence end date and recipe selections." });
export const ideaSchema = z.object({
  name: short, description: notes, category: short, link: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
  notes, priority: z.enum(["Low", "Normal", "High"]), status: z.enum(ideaStatuses), target: date.optional(), image: z.string().max(400).optional(),
});
export const taskSchema = z.object({
  title: short, date, status: z.enum(["Open", "Done", "Dismissed"]),
  section: z.enum(["Preparation", "Baking", "Photography", "Wrap Up"]),
  eventId: uuid.optional(), occurrence: date.optional(), offset: z.number().int().min(0).max(365).optional(),
});
const timerSchema = z.object({
  id: uuid, versionId: uuid, stepId: uuid, label: short, start: z.number().int().nonnegative(),
  deadline: z.number().int().nonnegative(), cancelled: z.boolean(),
}).refine((timer) => timer.deadline >= timer.start, { message: "Timer deadline must follow its start." });
export const feedbackSchema = z.object({
  yield: amount.optional(), taste: z.number().int().min(1).max(5).optional(),
  texture: z.number().int().min(1).max(5).optional(), appearance: z.number().int().min(1).max(5).optional(),
  notes, worked: notes, change: notes, again: z.enum(["", "Yes", "No"]),
});
export const sessionSchema = z.object({
  title: short, date, eventId: uuid.optional(), focusVersionId: uuid.optional(), mode: z.enum(modes), status: z.enum(["Active", "Completed"]), cleared: z.boolean().optional(),
  recipes: z.array(selectionSchema.extend({ completed: z.array(uuid).max(100) })).min(1).max(20),
  timers: z.array(timerSchema).max(300), prepared: z.array(z.string().max(1000)).max(3000),
  feedback: z.record(uuid, feedbackSchema), heroPhotos: z.record(uuid, uuid).optional(), shots: z.record(uuid, z.record(z.string().max(200), z.enum(shotStatuses))),
  oven: z.object({ phase: z.enum(["Available", "Preheating", "Occupied"]), temperature: z.number().int().min(75).max(650).optional(), notes }),
}).refine((session) => new Set(session.recipes.map((recipe) => recipe.versionId)).size === session.recipes.length, "Select each version once.");
export const photoSchema = z.object({
  sessionId: uuid, versionId: uuid, path: z.string().max(400), shot: short, captured: date,
  use: z.enum(["Website", "Instagram", "Facebook", "TikTok", "Product catalog", "Packaging"]),
  status: z.enum(shotStatuses), hero: z.boolean(),
});
export const referenceSchema = z.object({
  title: short, notes, path: z.string().min(1).max(400), versionId: uuid.optional(),
});
export const policySchema = z.object({ title: short, pattern: z.string().trim().min(2).max(200), enabled: z.boolean() });

export const schemas = { event: eventSchema, idea: ideaSchema, task: taskSchema, session: sessionSchema, photo: photoSchema, policy: policySchema, reference: referenceSchema };
export type Kind = keyof typeof schemas;
export type Doc<K extends Kind> = z.infer<(typeof schemas)[K]>;
export type Entry<K extends Kind = Kind> = { id: string; kind: K; revision: number; document: Doc<K> };
export type Recipe = z.infer<typeof recipeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Version = { id: string; recipe_id: string; created_at: string; document: Recipe };
export type Library = { versions: Version[]; favorites: string[]; approvals: Record<string, string> };
export type Selection = z.infer<typeof selectionSchema>;
export type Session = Doc<"session">;

export function easternDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(day: string, days: number): string {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function dateLabel(day: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export function occurs(event: Doc<"event">, day: string): boolean {
  if (event.status === "Cancelled" || day < event.date || event.excludedDates?.includes(day)) return false;
  if (day === event.date) return true;
  if (!event.until || day > event.until) return false;
  if (event.recurrence === "Weekly") return (Date.parse(day) - Date.parse(event.date)) % (7 * 86400000) === 0;
  return event.recurrence === "Monthly" && day.slice(8) === event.date.slice(8);
}

export function canBake(recipe: Pick<Recipe, "yieldLow" | "ingredients" | "steps">): boolean {
  return Boolean(recipe.yieldLow && recipe.ingredients.length && recipe.steps.length &&
    recipe.ingredients.every((ingredient) => ingredient.quantity !== null && recipe.steps.some((step) => step.ingredients.includes(ingredient.id))) &&
    recipe.steps.every((step) => step.kind !== "Oven" || step.temperature !== undefined));
}

export function activeVersions(library: Library) {
  const latest = new Map<string, Version>();
  for (const version of library.versions) if (!latest.has(version.recipe_id)) latest.set(version.recipe_id, version);
  return [...latest.values()].map((version) => version.document.status === "Archived" ? version :
    library.versions.find((item) => item.id === library.approvals[version.recipe_id]) ?? version);
}

export function scale(ingredient: Ingredient, recipe: Pick<Recipe, "yieldLow" | "yieldHigh">, target: number | null) {
  const { quantity, unit, gramsPerUnit } = ingredient;
  if (quantity === null || !recipe.yieldLow) return { amount: null, upper: null, unit, warning: "Check the original measurement." };
  const maxYield = recipe.yieldHigh ?? recipe.yieldLow;
  const numerator = new Decimal(quantity).mul(target ?? 1);
  const raw = numerator.div(target === null ? 1 : recipe.yieldLow);
  const rawLower = numerator.div(target === null ? 1 : maxYield);
  const warnings: string[] = [];
  if (target !== null && (target !== recipe.yieldLow || target !== maxYield)) {
    if (/\beggs?\b/i.test(ingredient.name) && (!raw.isInteger() || !rawLower.isInteger()) && !gramsPerUnit && !/^(g|grams?)$/i.test(unit)) warnings.push("Beat the egg and measure the indicated fraction. A verified weight is unavailable.");
    if (/yeast|baking powder|baking soda|salt/i.test(ingredient.name)) warnings.push("Review this scale-sensitive ingredient.");
    if (maxYield !== recipe.yieldLow) warnings.push("Original yield is a range. Confirm the baseline before measuring.");
  }
  const converted = numerator.mul(gramsPerUnit ?? 1);
  return {
    amount: converted.div(target === null ? 1 : maxYield),
    upper: converted.div(target === null ? 1 : recipe.yieldLow),
    unit: gramsPerUnit ? "g" : unit,
    warning: warnings.join(" "),
  };
}

// Cooking units use readable fractions when the saved amount is genuinely close
// to a standard fraction. Values that do not match keep their original precision.
const cookingFractions: [number, string][] = [
  [1 / 16, "⅟₁₆"], [1 / 8, "⅛"], [3 / 16, "³⁄₁₆"], [1 / 4, "¼"],
  [1 / 3, "⅓"], [3 / 8, "⅜"], [7 / 16, "⁷⁄₁₆"], [1 / 2, "½"],
  [9 / 16, "⁹⁄₁₆"], [5 / 8, "⅝"], [2 / 3, "⅔"], [11 / 16, "¹¹⁄₁₆"],
  [3 / 4, "¾"], [13 / 16, "¹³⁄₁₆"], [7 / 8, "⅞"], [15 / 16, "¹⁵⁄₁₆"],
];
const kitchenUnit = (unit: string, quantity: Decimal) => {
  const normalized = unit.trim().toLowerCase();
  const names = { cup: "cup", cups: "cup", teaspoon: "teaspoon", teaspoons: "teaspoon",
    tablespoon: "tablespoon", tablespoons: "tablespoon" } as Record<string, string>;
  const base = names[normalized];
  if (!base) return unit;
  const count = quantity.eq(1) || quantity.lt(1) ? base : base + "s";
  return unit.trim() && unit[0] === unit[0].toUpperCase() ? count[0].toUpperCase() + count.slice(1) : count;
};
export function formatAmount(value: ReturnType<typeof scale>) {
  if (value.amount === null) return "Check amount";
  const isKitchenMeasure = /^(cups?|teaspoons?|tablespoons?|tsp|tbsp)$/i.test(value.unit.trim());
  const format = (number: Decimal) => {
    if (isKitchenMeasure && number.gte(0)) {
      const whole = number.floor();
      const fraction = number.sub(whole).toNumber();
      if (number.isInteger()) return whole.toFixed();
      const hit = cookingFractions.find(([value]) => Math.abs(fraction - value) < 0.00001);
      if (hit) return (whole.isZero() ? "" : whole.toFixed()) + hit[1];
    }
    const rounded = number.toSignificantDigits(4).toFixed();
    return number.eq(rounded) ? rounded : `≈ ${rounded}`;
  };
  const range = value.upper && !value.amount.eq(value.upper) ? ` to ${format(value.upper)}` : "";
  return `${format(value.amount)}${range} ${kitchenUnit(value.unit, value.upper)}`.trim();
}

export function sharedIngredients(selections: Selection[], versions: Version[]) {
  const result = new Map<string, { name: string; preparation: string; allocations: { recipe: string; measurement: ReturnType<typeof scale> }[] }>();
  for (const selection of selections) {
    const version = versions.find((item) => item.id === selection.versionId);
    if (!version) continue;
    for (const ingredient of version.document.ingredients) {
      const measurement = scale(ingredient, version.document, selection.target);
      const key = JSON.stringify([ingredient.name.trim().toLowerCase(), ingredient.preparation.trim().toLowerCase(), measurement.unit.trim().toLowerCase()]);
      const row = result.get(key) ?? { name: ingredient.name, preparation: ingredient.preparation, allocations: [] };
      row.allocations.push({ recipe: version.document.name, measurement });
      result.set(key, row);
    }
  }
  return [...result].map(([key, row]) => {
    const known = row.allocations.every(({ measurement }) => measurement.amount && measurement.upper);
    const total = known ? {
      amount: Decimal.sum(...row.allocations.map(({ measurement }) => measurement.amount!)),
      upper: Decimal.sum(...row.allocations.map(({ measurement }) => measurement.upper!)),
      unit: row.allocations[0].measurement.unit,
      warning: "",
    } : null;
    return { key, ...row, total };
  });
}

export function timerTime(ms: number) {
  const seconds = Math.ceil(Math.abs(ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function currentSteps(session: Session, versions: Version[], now: number) {
  return session.recipes.flatMap((progress) => {
    const version = versions.find((item) => item.id === progress.versionId);
    const step = version?.document.steps.find((item) => !progress.completed.includes(item.id));
    if (!version || !step) return [];
    const timer = session.timers.findLast((item) => item.versionId === version.id && item.stepId === step.id && !item.cancelled);
    return [{ version, progress, step, timer, waiting: Boolean(timer && timer.deadline > now) }];
  });
}

type CurrentStep = ReturnType<typeof currentSteps>[number];

export function ovenBlocked(session: Session, rows: CurrentStep[], row: CurrentStep): boolean {
  if (row.step.kind !== "Oven") return false;
  const differentBatchInOven = rows.some((item) => item.version.id !== row.version.id && item.step.kind === "Oven" && item.timer);
  return differentBatchInOven ||
    (session.oven.phase === "Occupied" && !row.timer) ||
    (session.oven.phase === "Preheating" && session.oven.temperature !== row.step.temperature);
}

export function nextStep(session: Session, versions: Version[], now: number) {
  const steps = currentSteps(session, versions, now);
  if (session.mode !== "Smart Baking") return steps[0];
  const timedOut = steps.find((row) => row.timer && !row.waiting);
  return timedOut ?? steps.find((row) => !row.waiting && !ovenBlocked(session, steps, row)) ?? steps[0];
}

// Do not surface historic QA sessions as real baking production.
export function isLaunchCheckSession(title: string) {
  return /^\s*launch check(?:\s|[—–:-]|$)/i.test(title);
}

export function shotsFor(recipe: Recipe) {
  if (recipe.shots.length) return recipe.shots;
  if (/cake/i.test(recipe.category)) return ["Full cake", "Three-quarter angle", "Sliced interior", "Frosting detail", "Presentation"];
  if (/bread|sourdough/i.test(recipe.category)) return ["Whole loaf", "Crust detail", "Sliced interior", "Cutting board", "Cutting video"];
  return ["Hero shot", "Stacked product", "Broken-open texture", "Overhead", "Packaging", "Short video"];
}

export function blankRecipe(name = ""): Recipe {
  return { name, category: "Cookies", description: "", source: "", tags: [], yieldLow: null, yieldUnit: "pieces",
    status: "Draft", ingredients: [], steps: [], equipment: [], prep: [], storage: "", freezer: "",
    notes: "", changeReason: "", exceptions: [], shots: [] };
}

export function newSession(title: string, day: string, selections: Selection[], eventId?: string): Session {
  return {
    title, date: day, eventId, mode: "Sequential", status: "Active",
    recipes: selections.map((selection) => ({ ...selection, completed: [] })),
    timers: [], prepared: [], feedback: {}, shots: {}, oven: { phase: "Available", notes: "" },
  };
}

/** Hide a test session without deleting recipe versions, photos, or baking history. */
export function clearBakingSession(session: Session): Session {
  return { ...session, cleared: true, timers: session.timers.map((timer) => ({ ...timer, cancelled: true })) };
}

export function restoreBakingSession(session: Session): Session {
  return { ...session, cleared: false };
}
