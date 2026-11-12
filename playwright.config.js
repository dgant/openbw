const { defineConfig } = require("playwright/test");
const browserName = process.env.OPENBW_TEST_BROWSER || "chromium";

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8080",
    browserName,
    headless: true,
    launchOptions: {
      executablePath: browserName === "chromium" ? "/usr/bin/chromium" : undefined,
      args: browserName === "chromium" ? [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding"
      ] : []
    }
  }
});
