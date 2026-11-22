import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3100";
export default defineConfig({
  testDir: "tests/e2e", timeout: 60000, expect: { timeout: 7000 },
  use: { baseURL, actionTimeout: 10000, trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npm start -- --port 3100",
    url: baseURL, timeout: 120000, reuseExistingServer: false,
    env: { NEXT_PUBLIC_LOCAL_DEMO: "1", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
  },
  projects: [
    { name: "iPad viewport", use: { ...devices["Desktop Chrome"], viewport: { width: 1180, height: 820 }, hasTouch: true } },
    { name: "iPhone viewport", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
