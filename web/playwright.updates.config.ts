import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/updates",
  globalSetup: "./tests/updates/build-fixtures.mjs",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  use: {
    locale: "en-US",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    launchOptions: { args: ["--ignore-certificate-errors"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
