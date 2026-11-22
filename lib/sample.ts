import { blankRecipe, type Entry, type Library } from "./domain";

export const sampleProducts = [
  "Double chocolate chip cookies", "Coffee cake cookies", "S’mores cookies", "White chocolate Biscoff cookies",
  "Chocolate chip cookies", "Cinnamon rolls", "Artisan bread", "Sourdough", "Bagels", "Muffins", "Layer cakes",
  "Chocolate cake with espresso buttercream", "Lemon blueberry cake", "Rosemary garlic Dutch oven bread", "Croissants",
];

export const defaultPolicies = [
  ["No seed oils", "canola oil,soybean oil,sunflower oil,safflower oil,cottonseed oil,vegetable oil"],
  ["Verify flour is unbleached and unbromated", "flour"],
  ["Verify baking powder is aluminum-free", "baking powder"],
  ["Verify dairy is organic and grass-fed", "milk,butter,cream"],
  ["Verify eggs are organic and pasture-raised", "egg"],
  ["Verify chocolate is organic and free of seed oils", "chocolate"],
  ["Prefer real brewed espresso", "instant espresso,espresso powder"],
  ["Review artificial flavors and colors", "artificial,imitation,food coloring"],
  ["Review iodized salt", "iodized salt"],
  ["Consider an unrefined sweetener", "white sugar,granulated sugar"],
  ["Verify organic sourcing where applicable", "flour,sugar,chocolate,milk,butter,egg,vanilla"],
];

export function sampleData(): { records: Entry[]; library: Library } {
  const records: Entry[] = sampleProducts.map((name, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, kind: "idea", revision: 0,
    document: { name, description: "", category: index < 5 ? "Cookies" : "Other baked goods", link: "", notes: "", priority: "Normal", status: "Recipe Needed" },
  }));
  const versions = sampleProducts.slice(0, 4).map((name, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return {
      id: `20000000-0000-4000-8000-${suffix}`, recipe_id: `30000000-0000-4000-8000-${suffix}`,
      created_at: "2026-11-21T12:00:00Z",
      document: { ...blankRecipe(name), source: "Bekah Baking planning notes, November 21, 2026", description: "Reference draft. Verify the original recipe before baking." },
    };
  });
  records.push({
    id: "40000000-0000-4000-8000-000000000001", kind: "event", revision: 0,
    document: { title: "Cookie photography test", date: "2026-11-22", category: "Product photography", status: "Draft",
      recipes: versions.map(({ id: versionId }) => ({ versionId, target: 5 })), recurrence: "None", excludedDates: [],
      notes: "Historical sample plan. Outcome unconfirmed. Bekah considered baking full batches and freezing the remaining dough." },
  });
  return { records, library: { versions, approvals: {}, favorites: [] } };
}
