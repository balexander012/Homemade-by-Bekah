import { describe, expect, it } from "vitest";
import { parseRecipeImport } from "../lib/recipe-import";
import { fetchRecipeSource } from "../lib/public-recipe-source";

describe("reviewable recipe imports", () => {
  it("extracts recipe metadata with attribution and leaves ambiguous amounts unknown", () => {
    const source = "https://bakery.example/cookies";
    const recipe = parseRecipeImport(`<script type="application/ld+json">${JSON.stringify({
      "@graph": [{ "@type": "Recipe", name: "Cookie", recipeYield: "24–26 cookies",
        recipeIngredient: ["240 g unsalted butter", "2 1/2 cups flour", "2 - 3 eggs", "Salt to taste"],
        recipeInstructions: [{ "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "<b>Mix</b> well." }] }],
      }],
    })}</script>`, source);
    expect(recipe).toMatchObject({ source, status: "Draft", name: "Cookie", yieldLow: 24, yieldHigh: 26, yieldUnit: "cookies" });
    expect(recipe?.ingredients.map(({ quantity }) => quantity)).toEqual([240, 2.5, null, null]);
    expect(recipe?.steps[0]).toMatchObject({ instruction: "Mix well.", ingredients: [] });
    expect(recipe?.steps[0].temperature).toBeUndefined();
  });
  it("keeps ordinary pasted notes and incomplete metadata out of baking-ready mode", () => {
    expect(parseRecipeImport("Cookies with more espresso, maybe test tomorrow")).toBeNull();
    const result = parseRecipeImport(JSON.stringify({ "@type": "Recipe", name: "Bread", recipeYield: "Makes a large loaf" }));
    expect(result?.yieldLow).toBeNull();
    expect(result?.status).toBe("Draft");
  });
  it("rejects local addresses, credential-bearing URLs, and unsafe protocols", async () => {
    await expect(fetchRecipeSource("http://127.0.0.1")).rejects.toThrow(/public website/);
    await expect(fetchRecipeSource("http://[::1]")).rejects.toThrow(/public website/);
    await expect(fetchRecipeSource("http://username:password@example.org")).rejects.toThrow(/public HTTP/);
    await expect(fetchRecipeSource("file:///etc/hosts")).rejects.toThrow(/public HTTP/);
  });
});
