import { test, expect, type Page } from "@playwright/test";
import { easternDate, addDays } from "../../lib/domain";

const navigation = (page: Page, label: string) => page.getByRole("navigation").getByRole("button", { name: label, exact: true });

async function createRecipe(page: Page, name: string) {
  await navigation(page, "Recipes").click();
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByLabel("Original yield", { exact: true }).fill("24");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("Ready for Testing");
  await page.getByRole("button", { name: "Add ingredient" }).click();
  await page.getByLabel("Ingredient name").fill("Unsalted butter");
  await page.getByLabel("Quantity", { exact: true }).fill("240");
  await page.getByLabel("Unit", { exact: true }).fill("g");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Instruction", { exact: true }).fill("Mix the butter until smooth.");
  await page.getByLabel("Minutes", { exact: true }).fill("5");
  await page.getByText("Ingredients for this step").click();
  await page.getByRole("checkbox", { name: "Unsalted butter" }).check();
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("plans and reschedules batches, then resumes state and timers after an offline reload", async ({ page, context }) => {
  const today = easternDate();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today’s Plan" })).toBeVisible();
  const recipeNames = ["Test lemon cookies", "Test chocolate cookies", "Test vanilla cookies"];
  for (const name of recipeNames) await createRecipe(page, name);
  await navigation(page, "Today").click();
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await page.getByLabel("Event title").fill("Friday cookie test");
  for (const name of recipeNames) {
    await page.getByRole("checkbox", { name, exact: true }).check();
    await page.getByLabel(`Target for ${name}`).fill("5");
  }
  await page.getByRole("button", { name: "Save event" }).click();
  await navigation(page, "Today").click();
  await expect(page.getByRole("heading", { name: "Friday cookie test", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "Friday cookie test", exact: true }).locator("..").getByRole("button", { name: "Edit event" }).click();
  await page.getByLabel("Event date").fill(addDays(today, 1));
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page.getByRole("heading", { name: "Friday cookie test" })).toHaveCount(1);
  await page.getByRole("heading", { name: "Friday cookie test", exact: true }).locator("..").getByRole("button", { name: "Start baking" }).click();
  await page.getByRole("combobox", { name: "Baking mode", exact: true }).selectOption("Smart Baking");
  await page.getByRole("button", { name: "Begin session" }).click();
  await expect(page.getByText("50 g", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete step" }).click();
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("heading", { name: "Timers" })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Resume baking", exact: true }).click();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByText(/Test lemon cookies .*1 of 1 steps/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timers" })).toBeVisible();
  await context.setOffline(false);
  await navigation(page, "Photos").click();
  await expect(page.getByRole("heading", { name: "Test lemon cookies", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Hero shot", exact: true }).selectOption("Captured");
  await page.getByText("Baking feedback").click();
  await page.getByLabel("Actual yield").fill("5");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByText("Feedback saved", { exact: true })).toBeVisible();
});

test("uses real brand assets, persists theme and keeps the viewport free of horizontal scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today’s Plan" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect((await page.request.get("/icon-180.png")).ok()).toBe(true);
  await navigation(page, "More").click();
  await page.getByRole("combobox", { name: "Kitchen theme", exact: true }).selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
