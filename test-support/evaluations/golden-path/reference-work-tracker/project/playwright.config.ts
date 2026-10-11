import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: process.env.WEB_BASE_URL ?? "http://127.0.0.1:4173" },
  reporter: [["list"]],
});