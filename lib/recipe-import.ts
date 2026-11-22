import { blankRecipe, recipeSchema, type Recipe } from "./domain";

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function clean(value: unknown, length: number) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&(amp|quot|apos|lt|gt|nbsp|#39);/gi, (entity) => ({
    "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&#39;": "'",
  })[entity.toLowerCase()] ?? entity).replace(/\s+/g, " ").trim().slice(0, length);
}

function findRecipe(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 12) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findRecipe(item, depth + 1);
      if (result) return result;
    }
    return null;
  }
  const row = object(value);
  if (!row) return null;
  const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
  if (types.some((type) => typeof type === "string" && /(?:^|\/)Recipe$/.test(type))) return row;
  return findRecipe(row["@graph"] ?? row.mainEntity, depth + 1);
}

function parseDocuments(raw: string) {
  try { return [JSON.parse(raw) as unknown]; }
  catch {
    return Array.from(raw.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi))
      .slice(0, 30).flatMap((match) => {
        try { return [JSON.parse(match[1]) as unknown]; } catch { return []; }
      });
  }
}

function parseIngredient(value: string): Recipe["ingredients"][number] {
  const id = crypto.randomUUID();
  const quantityMatch = value.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)[ \t]+(.+)$/);
  if (!quantityMatch || /^[-–—]|^to\s+\d|^or\s+\d|^[½¼¾⅓⅔⅛]/i.test(quantityMatch[2])) return { id, name: value.slice(0, 200), quantity: null, unit: "", preparation: "" };
  const [whole, frac] = quantityMatch[1].split(/\s+/);
  function numeric(amount: string) {
    const [top, bottom] = amount.split("/").map(Number);
    return bottom === undefined ? top : top / bottom;
  }
  const quantity = numeric(whole) + (frac ? numeric(frac) : 0);
  const unitMatch = quantityMatch[2].match(/^(cups?|tablespoons?|teaspoons?|grams?|kilograms?|ounces?|pounds?|milliliters?|liters?|tsp\.?|tbsp\.?|g|kg|ml|l|oz|lb)\s+(.+?)$/i);
  const name = (unitMatch?.[2] ?? quantityMatch[2]).slice(0, 200);
  const unit = unitMatch?.[1] ?? "";
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) return { id, name: value.slice(0, 200), quantity: null, unit: "", preparation: "" };
  return { id, name, quantity, unit, preparation: "" };
}

function instructions(value: unknown, depth = 0): string[] {
  if (depth > 6 || !value) return [];
  if (typeof value === "string") return [clean(value, 3000)].filter(Boolean);
  if (Array.isArray(value)) return value.slice(0, 100).flatMap((item) => instructions(item, depth + 1)).slice(0, 100);
  const row = object(value);
  if (!row) return [];
  return instructions(row.itemListElement ?? row.text, depth + 1);
}

function textRecipe(raw: string): Record<string, unknown> | null {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = (line: string) => line.replace(/^[#*\s]+|[:*\s]+$/g, "").toLowerCase();
  const ingredientsAt = lines.findIndex((line) => /^ingredients?$/.test(heading(line)));
  const methodAt = lines.findIndex((line, index) => index > ingredientsAt && /^(instructions?|directions?|method|steps)$/.test(heading(line)));
  if (ingredientsAt < 1 || methodAt < ingredientsAt + 2 || methodAt === lines.length - 1) return null;
  const name = lines[0].replace(/^[#*\s]+|[*\s]+$/g, "");
  const yieldText = lines.slice(1, ingredientsAt).find((line) => /^(yield|makes|servings?)\s*:/i.test(line));
  return {
    "@type": "Recipe", name, recipeYield: yieldText?.slice(yieldText.indexOf(":") + 1).trim(),
    recipeIngredient: lines.slice(ingredientsAt + 1, methodAt).map((line) => line.replace(/^[-*•]\s+/, "")),
    recipeInstructions: lines.slice(methodAt + 1).map((line) => line.replace(/^(?:\d+[.)]|[-*•])\s+/, "")),
  };
}

export function parseRecipeImport(raw: string, attribution = ""): Recipe | null {
  for (const value of [...parseDocuments(raw), textRecipe(raw)]) {
    const supplied = object(value);
    if (supplied) {
      const draft = recipeSchema.safeParse({ ...supplied, status: "Draft" });
      if (draft.success) return { ...draft.data, source: attribution || draft.data.source };
    }
    const recipe = findRecipe(value);
    const name = clean(recipe?.name, 200);
    if (!recipe || !name) continue;
    const yieldVal = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield;
    const label = clean(typeof yieldVal === "number" ? String(yieldVal) : yieldVal, 200);
    const yieldParts = label.match(/^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?(?:\s+([a-z][a-z\s-]*))?$/i);
    const draft = blankRecipe(name);
    return {
      ...draft, source: attribution || clean(recipe.url, 15000), description: clean(recipe.description, 15000),
      category: clean(Array.isArray(recipe.recipeCategory) ? recipe.recipeCategory[0] : recipe.recipeCategory, 200) || draft.category,
      yieldLow: yieldParts ? Number(yieldParts[1]) : null,
      yieldHigh: yieldParts?.[2] ? Number(yieldParts[2]) : undefined,
      yieldUnit: yieldParts?.[3] || draft.yieldUnit,
      ingredients: Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.slice(0, 100).map((item) => clean(item, 200)).filter(Boolean).map(parseIngredient) : [],
      steps: instructions(recipe.recipeInstructions).map((instruction) => ({ id: crypto.randomUUID(), instruction, kind: "Work", ingredients: [] })),
      notes: [
        "Review the source for temperatures, times, and which ingredients belong in each step.",
        label && !yieldParts ? `Source yield to verify: ${label}` : "",
      ].filter(Boolean).join("\n"),
    };
  }
  return null;
}
