import { z } from "zod";
import { canBake, date, easternTimeExists, eventSchema, ideaSchema, recipeSchema, taskSchema, uuid, type Recipe } from "./domain";

const label = z.string().trim().min(1).max(200);
const key = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const provenance = z.string().trim().min(1).max(1000);
const identity = {
  recipeKey: key, existingRecipeId: uuid.optional(), aliases: z.array(label).max(12).default([]),
  sourceKey: key.optional(),
};
const header = { schemaVersion: z.literal(1), importId: uuid };
const recipeImport = z.strictObject({
  ...header, ...identity, kind: z.literal("recipe"), finalizedOn: date.optional(),
  verification: z.enum(["Finalized", "Needs review"]), sourceReferences: z.array(provenance).min(1).max(15),
  issues: z.array(provenance).max(25).default([]),
  // "publish" when Bekah asks to put the recipe in the app. Absent or "draft" keeps it as a working draft.
  publicationIntent: z.enum(["draft", "publish"]).optional(),
  // Only a bake Bekah confirms she made with this exact formula. Without it a published recipe is Ready for Testing.
  tested: z.strictObject({ testedOn: date, notes: provenance.optional() }).optional(),
  // Dough or batter weight per piece, when the recipe states one. Used to check the listed weights.
  portionWeightGrams: z.number().positive().max(100000).optional(),
  // A bake date Bekah gave. It becomes a calendar event.
  schedule: z.strictObject({
    date, title: label.optional(), start: z.iso.time({ precision: -1 }).optional(), end: z.iso.time({ precision: -1 }).optional(),
    target: z.number().positive().max(100000).optional(), notes: z.string().max(2000).optional(),
  }).refine((value) => (!value.end || Boolean(value.start && value.end > value.start)) &&
    (!value.start || easternTimeExists(value.date, value.start)) && (!value.end || easternTimeExists(value.date, value.end)),
  { message: "Check the bake date and times in New York." }).optional(),
  recipe: recipeSchema.safeExtend({ status: z.literal("Draft") }),
});
const lookup = z.strictObject({ ...header, ...identity, kind: z.literal("lookup"), name: label });

export const recipeInboxSchema = z.discriminatedUnion("kind", [recipeImport, lookup]).superRefine((value, context) => {
  if (value.kind !== "recipe") return;
  if (value.tested && value.publicationIntent !== "publish") {
    context.addIssue({ code: "custom", path: ["tested"], message: "Only a published recipe can carry a confirmed test." });
  }
});
export type RecipeInbox = z.infer<typeof recipeInboxSchema>;

export function reviewIssues(input: z.infer<typeof recipeImport>): string[] {
  const { recipe } = input;
  const issues = [...input.issues];
  if (input.verification !== "Finalized") issues.push("Bekah’s final version has not been verified.");
  if (input.publicationIntent === "publish") issues.push(...publicationIssues(input));
  if (!recipe.source.trim()) issues.push("Provide the original source and attribution.");
  if (!recipe.yieldLow) issues.push("Confirm the original batch yield.");
  if (!recipe.ingredients.length) issues.push("Provide the complete ingredient list.");
  for (const ingredient of recipe.ingredients) {
    if (ingredient.quantity === null || !ingredient.unit.trim()) issues.push(`Confirm the exact amount and unit for ${ingredient.name}.`);
    if (!recipe.steps.some((step) => step.ingredients.includes(ingredient.id))) issues.push(`Confirm where to use ${ingredient.name}.`);
  }
  if (!recipe.steps.length) issues.push("Provide the instructions in order.");
  recipe.steps.forEach((step, index) => {
    if (step.kind === "Oven" && !step.temperature) issues.push(`Confirm the oven temperature for step ${index + 1}.`);
    if ((step.kind === "Oven" || step.kind === "Rest" || step.kind === "Cool") && !step.minutes) {
      issues.push(`Confirm the timing for step ${index + 1}.`);
    }
  });
  return [...new Set(issues)].slice(0, 40);
}

const gramUnit = /^(g|grams?)$/i;

// Checks that only matter before a recipe goes straight into the app.
export function publicationIssues(input: z.infer<typeof recipeImport>): string[] {
  const { recipe } = input;
  const issues: string[] = [];
  recipe.steps.forEach((step, index) => {
    // A timer that disagrees with the written time would mislead a guided bake.
    if (step.minutes) {
      const ranges = [...step.instruction.matchAll(/(\d+(?:\.\d+)?)\s*(?:(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*)?min/gi)]
        .map((match) => [Number(match[1]), Number(match[2] ?? match[1])]);
      if (ranges.length && !ranges.some(([low, high]) => step.minutes! >= low && step.minutes! <= high)) {
        issues.push(`Step ${index + 1} has a ${step.minutes}-minute timer, but its instructions say ${ranges.map(([low, high]) => low === high ? `${low}` : `${low} to ${high}`).join(" or ")} minutes.`);
      }
    }
    if (step.temperature && /\d{3}\s*°?\s*f/i.test(step.instruction) && !new RegExp(`${step.temperature}\\s*°?\\s*f`, "i").test(step.instruction)) {
      issues.push(`Step ${index + 1} is set to ${step.temperature} °F, but its instructions give a different temperature.`);
    }
  });
  if (input.portionWeightGrams && recipe.yieldLow) {
    const total = input.portionWeightGrams * recipe.yieldLow;
    const grams = recipe.ingredients.reduce((sum, item) => sum + (item.quantity === null ? 0 :
      gramUnit.test(item.unit.trim()) ? item.quantity : item.gramsPerUnit ? item.quantity * item.gramsPerUnit : 0), 0);
    const allWeighed = recipe.ingredients.every((item) => item.quantity !== null && (gramUnit.test(item.unit.trim()) || item.gramsPerUnit));
    if (grams > total * 1.05 || (allWeighed && grams < total * 0.9)) {
      issues.push(`The listed weights add up to about ${Math.round(grams)} g${allWeighed ? "" : " before the unweighed ingredients"}, but ${recipe.yieldLow} × ${input.portionWeightGrams} g is ${Math.round(total)} g. Confirm the yield, portion weight or quantities.`);
    }
  }
  return issues;
}

export const planInboxSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...header, kind: z.literal("event"), recordId: uuid, expectedRevision: z.number().int().min(0).optional(),
    event: eventSchema.refine((value) => value.status === "Scheduled" && !value.excludedDates.length, "Only scheduled events without cancellations can be imported.") }),
  z.strictObject({ ...header, kind: z.literal("task"), recordId: uuid, task: taskSchema.safeExtend({
    status: z.literal("Open"), section: z.literal("Preparation"),
  }) }),
  z.strictObject({ ...header, kind: z.literal("idea"), recordId: uuid, idea: ideaSchema.safeExtend({
    status: z.literal("Idea"), image: z.undefined().optional(),
  }) }),
]);

export const approvalCandidate = (recipe: Recipe) => canBake(recipe) && recipe.source.trim() &&
  recipe.ingredients.every((item) => Boolean(item.unit.trim())) &&
  recipe.steps.every((step) => step.kind === "Work" || Boolean(step.minutes));
