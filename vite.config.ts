import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  plugins: [
    sites(),
    cloudflare({
      viteEnvironment: { name: "server" },
      config: {
        main: "./worker/index.ts",
        compatibility_date: "2026-05-22",
        assets: {
          binding: "ASSETS",
          not_found_handling: "single-page-application",
        },
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
