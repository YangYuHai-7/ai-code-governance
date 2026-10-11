import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  use: { baseURL: process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000" },
  reporter: [["list"]],
});
