import { test, expect, type Page } from "@playwright/test";
import { easternDate, addDays } from "../../lib/domain";

const navigation = (page: Page, label: string) => page.getByRole("navigation").getByRole("button", { name: label, exact: true });

async function createRecipe(page: Page, name: string, status = "Ready for Testing") {
  await navigation(page, "Recipes").click();
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill(name);
  await page.getByLabel("Original yield", { exact: true }).fill("24");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption(status);
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
  await page.getByRole("radio", { name: /^Smart Baking/ }).check();
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

test("keeps an approved recipe while a new draft is being developed", async ({ page }) => {
  await page.goto("/");
  await createRecipe(page, "Test espresso cookies", "Tested");
  await page.getByRole("button", { name: "Make preferred version" }).click();
  await page.getByRole("button", { name: "Make preferred", exact: true }).click();
  await expect(page.getByText("Preferred", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tested", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "New revision" }).click();
  await page.getByLabel("Recipe name").fill("Test espresso cookies revision");
  await page.getByLabel("Reason for revision").fill("Try real brewed espresso.");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { name: "Test espresso cookies revision", exact: true })).toBeVisible();
  await expect(page.getByText("Try real brewed espresso.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All recipes" }).click();
  await expect(page.getByRole("heading", { name: "Test espresso cookies", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test espresso cookies revision", exact: true })).toHaveCount(0);
});

test("reviews recipe text extracted from Word, PDF and a screenshot", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await navigation(page, "Recipes").click();
  await page.getByRole("button", { name: "New recipe" }).click();
  await page.getByText("Import source text").click();
  const input = page.getByLabel("Upload a document or screenshot");
  const paste = page.getByLabel("Paste recipe or transcript");
  await input.setInputFiles("tests/fixtures/test-recipe.docx");
  await expect(paste).toHaveValue(/240 g unsalted butter/i);
  await page.getByRole("button", { name: "Review pasted source" }).click();
  await expect(page.getByLabel("Recipe name")).toHaveValue("Test shortbread");
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("240");
  await input.setInputFiles("tests/fixtures/test-recipe.pdf");
  await expect(paste).toHaveValue(/240 g unsalted butter/i);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 260;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.font = "48px Arial";
    ctx.fillText("240 g unsalted butter", 40, 100);
    ctx.fillText("Mix the butter until smooth.", 40, 180);
    return canvas.toDataURL().split(",")[1];
  });
  await paste.clear();
  await input.setInputFiles({ name: "recipe.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(paste).toHaveValue(/240 g unsalted butter/i, { timeout: 55000 });
});

test("makes an untested, finalized recipe preferred without calling it tested", async ({ page }) => {
  await page.goto("/");
  await createRecipe(page, "Test finalized rolls", "Ready for Testing");
  await page.getByRole("button", { name: "Make preferred version" }).click();
  await expect(page.getByText("This version has not been tested yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Make preferred", exact: true }).click();
  await expect(page.getByText("Preferred", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ready for Testing", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tested", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start baking" }).first().click();
  await expect(page.getByText("Test finalized rolls").first()).toBeVisible();
});
