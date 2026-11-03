import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  testMatch: "startup.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 240_000,
  outputDir: "test-results/performance",
  reporter: "list",
  use: {
    ...devices["Pixel 5"],
    baseURL: "https://127.0.0.2:3101",
    locale: "ko-KR",
    ignoreHTTPSErrors: true,
    // Service Workers also need to accept the disposable local certificate.
    launchOptions: { args: ["--ignore-certificate-errors"] },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node tests/performance/server.mjs",
    url: "https://127.0.0.2:3101",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
