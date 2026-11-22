import { z } from "zod";
import { canBake, date, eventSchema, ideaSchema, recipeSchema, taskSchema, uuid, type Recipe } from "./domain";

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
  recipe: recipeSchema.safeExtend({ status: z.literal("Draft") }),
});
const lookup = z.strictObject({ ...header, ...identity, kind: z.literal("lookup"), name: label });

export const recipeInboxSchema = z.discriminatedUnion("kind", [recipeImport, lookup]);
export type RecipeInbox = z.infer<typeof recipeInboxSchema>;

export function reviewIssues(input: z.infer<typeof recipeImport>): string[] {
  const { recipe } = input;
  const issues = [...input.issues];
  if (input.verification !== "Finalized") issues.push("Bekah’s final version has not been verified.");
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
