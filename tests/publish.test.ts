import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { recipeInboxSchema, reviewIssues } from "../lib/sync-import";

const pending = async (id: string) =>
  JSON.parse(await readFile(new URL(`../recipe-imports/pending/${id}.json`, import.meta.url), "utf8"));
const issuesFor = (input: unknown) => {
  const parsed = recipeInboxSchema.parse(input);
  if (parsed.kind !== "recipe") throw new Error("Expected a recipe");
  return reviewIssues(parsed);
};

describe("publishing checks on Bekah's submitted recipes", () => {
  it("blocks the six-cookie jumbo formula whose weights do not fit six 98 g portions", async () => {
    const jumbo = await pending("7c9196f6-b67b-489c-9b07-875480c4e1e6");
    const issues = issuesFor({ ...jumbo, publicationIntent: "publish", portionWeightGrams: 98, issues: [] });
    expect(issues.join(" ")).toMatch(/692 g before the unweighed ingredients, but 6 × 98 g is 588 g/);
  });

  it("lets the latest cinnamon roll formula through and leaves it untested", async () => {
    const rolls = await pending("bde169f4-d035-49e0-a235-36cb67549f8c");
    const parsed = recipeInboxSchema.parse({ ...rolls, publicationIntent: "publish" });
    expect(issuesFor(parsed)).toEqual([]);
    expect(parsed.kind === "recipe" && parsed.tested).toBeUndefined();
  });

  it("keeps the white chocolate Biscoff and s'mores working drafts unpublished", async () => {
    for (const id of ["d81c8e40-2732-4705-8475-01c84d8b5eae", "cf48333c-e3ea-4e90-920d-68de761068b1"]) {
      const draft = await pending(id);
      expect(issuesFor({ ...draft, publicationIntent: "publish" }).length).toBeGreaterThan(0);
    }
  });

  it("flags a step timer that disagrees with its written time", async () => {
    const rolls = await pending("bde169f4-d035-49e0-a235-36cb67549f8c");
    const steps = rolls.recipe.steps.map((step: { kind: string; minutes?: number }) => step.kind === "Rest" && step.minutes === 5 ? { ...step, minutes: 50 } : step);
    expect(issuesFor({ ...rolls, publicationIntent: "publish", recipe: { ...rolls.recipe, steps } }).join(" "))
      .toMatch(/50-minute timer, but its instructions say 5 minutes/);
  });

  it("accepts every existing inbox file unchanged so earlier receipts still replay", async () => {
    for (const id of ["6ec1e1bd-41ce-49c1-ae51-46c7a6eb37d1", "a3e95cb3-8954-469f-b07f-baf3c7fa2ac9", "d1107115-3e40-4b8b-968f-3a0c13e00d3a"]) {
      const raw = await pending(id);
      expect(JSON.parse(JSON.stringify(recipeInboxSchema.parse(raw)))).not.toHaveProperty("publicationIntent");
    }
  });
});
