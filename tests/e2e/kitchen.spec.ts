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
  await navigation(page, "Home").click();
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await page.getByLabel("Event title").fill("Friday cookie test");
  for (const name of recipeNames) {
    await page.getByRole("checkbox", { name, exact: true }).check();
    await page.getByLabel(`Target for ${name}`).fill("5");
  }
  await page.getByRole("button", { name: "Save event" }).click();
  await navigation(page, "Home").click();
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
  await expect(page.locator(".bake-timer-toggle")).toContainText("active timer");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Friday cookie test", exact: true })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Baking session sections" }).getByRole("button", { name: "Overview" }).click();
  await expect(page.locator(".bake-overview-row").filter({ hasText: "Test lemon cookies" })).toContainText("1 of 1 steps");
  await expect(page.locator(".bake-timer-toggle")).toBeVisible();
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
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

test("adds recipe photos, sets and changes the main photo, and removes one without touching the recipe", async ({ page }) => {
  const sharp = (await import("sharp")).default;
  const jpeg = (r: number, g: number, b: number) => sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  await page.goto("/");
  await createRecipe(page, "Test photo cookies");
  const ingredients = await page.getByRole("heading", { name: "Ingredients" }).locator("..").innerText();
  await page.getByRole("button", { name: "Add Photos" }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.jpg", mimeType: "image/jpeg", buffer: await jpeg(200, 140, 60) },
    { name: "second.jpg", mimeType: "image/jpeg", buffer: await jpeg(90, 60, 30) },
  ]);
  await expect(page.getByAltText("Preview of second.jpg")).toBeVisible();
  // The first photo is the default main photo when the recipe has none.
  await expect(page.getByRole("radio", { name: "Main photo" }).first()).toBeChecked();
  await page.getByRole("button", { name: "Edit photo" }).first().click();
  await page.getByRole("button", { name: "Rotate" }).click();
  await page.getByLabel("Zoom").fill("1.5");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save 2 photos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Photos saved." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select photo 1, main photo" })).toBeVisible();
  await expect(page.locator(".recipe-hero img")).toBeVisible();
  const hero = await page.locator(".recipe-hero img").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(hero).toEqual([1920, 1080]);
  // The main photo replaces the placeholder on the recipe card.
  await page.getByRole("button", { name: "All recipes" }).click();
  const card = page.locator(".recipe-card").filter({ hasText: "Test photo cookies" });
  await expect(card.locator(".recipe-thumb.has-photo img")).toBeVisible();
  await card.getByRole("button", { name: "Test photo cookies" }).click();
  // Change the main photo, reorder, caption, then remove one after confirming.
  await page.getByRole("button", { name: "Select photo 2" }).click();
  await page.getByRole("button", { name: "Set as Main" }).click();
  await expect(page.getByRole("button", { name: "Select photo 2, main photo" })).toBeVisible();
  await page.getByLabel("Caption", { exact: true }).fill("Golden edges");
  await page.getByRole("button", { name: "Save caption" }).click();
  await expect(page.getByText("Golden edges", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move earlier" }).click();
  await expect(page.getByRole("button", { name: "Select photo 1, main photo" })).toBeVisible();
  await page.getByRole("button", { name: "Select photo 2" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.locator(".photo-gallery li")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Select photo 1, main photo" })).toBeVisible();
  // Photos never create a recipe revision or change the formula.
  expect(await page.getByRole("heading", { name: "Ingredients" }).locator("..").innerText()).toBe(ingredients);
  await expect(page.getByRole("heading", { name: "Version history" }).locator("..").locator(".row")).toHaveCount(1);
  // The main photo also shows when choosing recipes to bake.
  await page.getByRole("button", { name: "Start baking" }).first().click();
  await expect(page.locator(".pick .recipe-thumb.has-photo img").first()).toBeVisible();
});

test("explains unsupported photo files instead of saving them", async ({ page }) => {
  await page.goto("/");
  await createRecipe(page, "Test unsupported photo");
  await page.getByRole("button", { name: "Add Photos" }).click();
  await page.locator('input[type="file"]').setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") }]);
  await expect(page.locator(".photo-dialog .notice.error")).toContainText("notes.txt is not a JPEG, PNG, WebP or HEIC photo.");
  await expect(page.getByRole("button", { name: /Save .*photo/ })).toBeDisabled();
});

test("deep-links to recipe and baking session screens and preserves browser history", async ({ page }) => {
  await page.goto("/");
  await createRecipe(page, "Deep link oatmeal cookies");
  await expect(page).toHaveURL(/\/recipes\/[a-f0-9-]+$/);
  const recipeUrl = page.url();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Deep link oatmeal cookies", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start baking" }).click();
  await expect(page).toHaveURL(/\/bake\/new\?/);
  await page.getByRole("button", { name: "Begin session" }).click();
  await expect(page).toHaveURL(/\/bake\/[a-f0-9-]+$/);
  const sessionUrl = page.url();
  await page.reload();
  await expect(page.getByRole("button", { name: "Leave baking session" })).toBeVisible();
  await page.getByRole("button", { name: "Leave baking session" }).click();
  await expect(page).toHaveURL(/\/bake$/);
  await page.goBack();
  await expect(page).toHaveURL(sessionUrl);
  await page.goto(recipeUrl);
  await expect(page.getByRole("heading", { name: "Deep link oatmeal cookies", exact: true })).toBeVisible();
});

test("keeps active baking steps focused with accessible preparation and overview", async ({ page }) => {
  await page.goto("/");
  await createRecipe(page, "Baking workflow test");
  await page.getByRole("button", { name: "Start baking" }).click();
  await page.getByRole("button", { name: "Begin session" }).click();
  await expect(page.locator(".bake-current-step")).toBeVisible();
  await expect(page.locator(".bake-current-step")).toContainText("Mix the butter until smooth.");
  const sections = page.getByRole("navigation", { name: "Baking session sections" });
  await sections.getByRole("button", { name: "Prep" }).click();
  await expect(page.getByRole("heading", { name: "Gather ingredients" })).toBeVisible();
  await sections.getByRole("button", { name: "Overview" }).click();
  await expect(page.locator(".bake-overview-row")).toContainText("0 of 1 steps");
  await sections.getByRole("button", { name: "Steps" }).click();
  await page.getByRole("button", { name: "Complete step" }).click();
  await sections.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "Complete baking session" }).click();
  await page.getByRole("button", { name: "Yes, finish session" }).click();
  await expect(page.getByText("Baking session completed.")).toBeVisible();
});
