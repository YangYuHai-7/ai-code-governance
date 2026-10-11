import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist/web", emptyOutDir: true, target: "es2022" },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
