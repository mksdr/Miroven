import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  webServer: {
    command: "node scripts/serve-test.mjs",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    locale: "ko-KR",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testMatch: ["images.spec.ts", "quotes.spec.ts", "persona.spec.ts", "keyboard-a11y.spec.ts", "composer-startup.spec.ts", "pin-key-lifetime.spec.ts"],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-images",
      testMatch: ["images.spec.ts", "quotes.spec.ts", "persona.spec.ts", "composer-startup.spec.ts", "pin-key-lifetime.spec.ts"],
      use: { ...devices["iPhone 13"] },
    },
  ],
});
