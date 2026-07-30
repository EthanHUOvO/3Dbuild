import { resolve } from "node:path";
import { defineConfig } from "vite";

const base = process.env.PAGES_BASE_PATH ?? "/3Dbuild/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        pavilion: resolve(process.cwd(), "pavilion.html"),
        restroom: resolve(process.cwd(), "restroom.html"),
        workerRoom: resolve(process.cwd(), "worker-room.html"),
      },
    },
  },
});
