/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` makes a normal static site in dist/ (relative paths, so it works from any sub-folder,
// e.g. GitHub Pages). `npm run build:single` inlines everything into one HTML file in dist-single/.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "single" ? [viteSingleFile()] : [],
  build: mode === "single" ? { outDir: "dist-single", assetsInlineLimit: 100_000_000 } : { outDir: "dist" },
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 120_000
  }
}));
