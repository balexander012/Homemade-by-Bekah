import { describe, expect, it } from "vitest";
import { addDays, blankRecipe, currentSteps, isLaunchCheckSession, easternDate, easternTimeExists, eventSchema, formatAmount, newSession, nextStep, occurs, recipeSchema, scale, sharedIngredients, type Entry, type Ingredient, type Version } from "../lib/domain";
import { planTasks } from "../lib/plan";

const id = () => crypto.randomUUID();
const butter = { id: id(), name: "Unsalted butter", quantity: 240, unit: "g", preparation: "softened" } satisfies Ingredient;
const cookie = (name = "Cookie", temperature = 350): Version => ({
  id: id(), recipe_id: id(), created_at: "2026-11-21T12:00:00Z",
  document: { ...blankRecipe(name), status: "Ready for Testing", yieldLow: 24, ingredients: [butter],
    prep: [{ title: "Prepare dough", daysBefore: 1 }], steps: [
      { id: id(), instruction: "Chill", kind: "Rest", minutes: 10, ingredients: [butter.id] },
      { id: id(), instruction: "Bake", kind: "Oven", minutes: 10, temperature, ingredients: [] },
    ] },
});

describe("New York planning", () => {
  it("handles DST boundaries and validates civil dates", () => {
    expect(easternDate(new Date("2026-03-08T04:59:59Z"))).toBe("2026-03-07");
    expect(easternDate(new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(easternDate(new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(easternTimeExists("2026-03-08", "02:30")).toBe(false);
    expect(easternTimeExists("2026-11-01", "01:30")).toBe(true);
    expect(eventSchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });
  it("recurs on civil dates and skips cancelled occurrences", () => {
    const event = eventSchema.parse({ title: "Test", date: "2026-03-06", category: "Recipe testing", status: "Scheduled", recipes: [], notes: "", recurrence: "Weekly", until: "2026-03-27", excludedDates: ["2026-03-20"] });
    expect(occurs(event, "2026-03-13")).toBe(true);
    expect(occurs(event, "2026-03-20")).toBe(false);
    expect(occurs(event, "2026-04-03")).toBe(false);
  });
  it("keeps completed prep tied to a rescheduled event without duplicating it", async () => {
    const version = cookie();
    const entry: Entry<"event"> = { id: id(), kind: "event", revision: 0, document: {
      title: "Cookie photography", date: "2026-11-27", status: "Scheduled", category: "Product photography",
      recipes: [{ versionId: version.id, target: 5 }], recurrence: "None", notes: "", excludedDates: [],
    } };
    const initial = await planTasks([entry], [], [version], "2026-11-26", 3);
    const first = initial.find((item) => item.document.title === "Prepare dough · Cookie")!;
    const moved = await planTasks([{ ...entry, document: { ...entry.document, date: "2026-11-28" } }],
      [{ ...first, document: { ...first.document, status: "Done" } }], [version], "2026-11-26", 3);
    expect(moved.filter((item) => item.document.title === first.document.title)).toEqual([
      { ...first, document: { ...first.document, date: "2026-11-27", status: "Done" } },
    ]);
  });
});

describe("QA record visibility", () => {
  it("excludes known launch checks without hiding actual baking sessions", () => {
    expect(isLaunchCheckSession("Launch check — butter batch A")).toBe(true);
    expect(isLaunchCheckSession("Launch check – two-batch workflow")).toBe(true);
    expect(isLaunchCheckSession("LAUNCH CHECK: staging")).toBe(true);
    expect(isLaunchCheckSession("Bake Jumbo Chocolate Chip, S'mores Cookies and Cinnamon Rolls")).toBe(false);
    expect(isLaunchCheckSession("Launching chocolate cookies")).toBe(false);
  });
});

describe("guided baking", () => {
  it("scales 24 to 5 without altering the original and warns about unknown egg weights", () => {
    const recipe = cookie().document;
    expect(formatAmount(scale(butter, recipe, 5))).toBe("50 g");
    expect(recipe.ingredients[0].quantity).toBe(240);
    const egg = { ...butter, name: "Egg", unit: "whole", quantity: 2 };
    expect(scale(egg, recipe, 5).warning).toContain("verified weight");
    expect(formatAmount(scale({ ...egg, gramsPerUnit: 48 }, recipe, 5))).toBe("20 g");
    expect(scale(egg, { ...recipe, yieldHigh: 30 }, 5).warning).toContain("range");
  });
  it("formats kitchen measures as fractions without rounding nonstandard quantities", () => {
    const recipe = { yieldLow: 1, yieldHigh: undefined };
    const amount = (quantity: number, unit: string) =>
      formatAmount(scale({ id: id(), name: "Ingredient", quantity, unit, preparation: "" }, recipe, null));
    expect(amount(0.75, "cup")).toBe("¾ cup");
    expect(amount(0.5, "cup")).toBe("½ cup");
    expect(amount(1.25, "cup")).toBe("1¼ cups");
    expect(amount(2.5, "teaspoon")).toBe("2½ teaspoons");
    expect(amount(1, "tablespoon")).toBe("1 tablespoon");
    expect(amount(0.333333333, "cup")).toBe("⅓ cup");
    expect(amount(0.31, "cup")).toBe("0.31 cup");
    expect(amount(50, "g")).toBe("50 g");
    expect(amount(2.5, "tsp")).toBe("2½ tsp");
  });
  it("combines identical preparation and keeps different butter and preparations separate", () => {
    const a = cookie("A");
    const b = cookie("B");
    b.document.ingredients = [butter, { ...butter, preparation: "melted" }, { ...butter, name: "Salted butter" }];
    const rows = sharedIngredients([{ versionId: a.id, target: 5 }, { versionId: b.id, target: 5 }], [a, b]);
    expect(rows).toHaveLength(3);
    expect(rows[0].allocations.map((item) => item.recipe)).toEqual(["A", "B"]);
    expect(formatAmount(rows[0].total!)).toBe("100 g");
  });
  it("coordinates rest timers and oven conflicts without completing steps automatically", () => {
    const versions = [cookie("A"), cookie("B", 400), cookie("C")];
    const session = newSession("Bake", "2026-11-22", versions.map(({ id }) => ({ versionId: id, target: 5 })));
    session.mode = "Smart Baking";
    const [a, b, c] = versions;
    const now = Date.now();
    session.timers.push({ id: id(), versionId: a.id, stepId: a.document.steps[0].id, start: now, deadline: now + 600000, label: "Chill A", cancelled: false });
    expect(nextStep(session, versions, now)?.version.id).toBe(b.id);
    expect(currentSteps(session, versions, now + 600001)[0].step.kind).toBe("Rest");
    session.recipes[0].completed.push(a.document.steps[0].id);
    session.recipes[1].completed.push(b.document.steps[0].id);
    session.timers.push({ id: id(), versionId: a.id, stepId: a.document.steps[1].id, start: now, deadline: now + 600000, label: "Bake A", cancelled: false });
    expect(nextStep(session, versions, now)?.version.id).toBe(c.id);
  });
  it("prevents incomplete reference recipes from becoming baking-ready", () => {
    expect(recipeSchema.safeParse({ ...blankRecipe("Reference"), status: "Ready for Testing" }).success).toBe(false);
    expect(recipeSchema.safeParse(cookie().document).success).toBe(true);
  });
});
