import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120000,
  use: {
    actionTimeout: 10000,
    baseURL: process.env.DEMO_URL || "http://127.0.0.1:3700",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: process.env.DEMO_URL
    ? undefined
    : {
        command: "PORT=3700 npm start",
        url: "http://127.0.0.1:3700/api/health",
        reuseExistingServer: false,
        timeout: 30000,
      },
  reporter: "list",
});
