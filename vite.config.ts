import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";
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
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(process.cwd(), "index.html"),
            pavilion: resolve(process.cwd(), "pavilion.html"),
            restroom: resolve(process.cwd(), "restroom.html"),
          },
        },
      },
    },
  },
});
