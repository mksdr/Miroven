import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/offline",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "https://127.0.0.2:3101",
    locale: "en-US",
    ignoreHTTPSErrors: true,
    launchOptions: { args: ["--ignore-certificate-errors"] },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-workers", testMatch: "worker-images.spec.ts", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "node tests/performance/server.mjs",
    url: "https://127.0.0.2:3101",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
