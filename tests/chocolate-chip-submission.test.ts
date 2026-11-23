import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recipeInboxSchema, reviewIssues } from "../lib/sync-import";

describe("Bekah's November 22 jumbo chocolate chip submission", () => {
  it("preserves six portions of 98 g but flags the contradictory ingredient total", () => {
    const submitted: unknown = JSON.parse(readFileSync(
      new URL("../recipe-imports/pending/5a7b466c-73b8-4329-8927-65a6cfe4f115.json", import.meta.url), "utf8"));
    const input = recipeInboxSchema.parse(submitted);
    expect(input.kind).toBe("recipe");
    if (input.kind !== "recipe") return;
    expect(input.recipe.yieldLow).toBe(6);
    expect(input.recipe.yieldHigh).toBeUndefined();
    expect(input.portionWeightGrams).toBe(98);
    expect(input.publicationIntent).toBe("publish");
    expect(input.recipe.steps.find((step) => step.kind === "Oven")).toMatchObject({ minutes: 18, temperature: 350 });
    expect(reviewIssues(input).some((issue) => /692|weights|dough mass|588/i.test(issue))).toBe(true);
  });
});
