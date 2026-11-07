import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

// Vite HMR needs an inline preamble script and a websocket; dev server only.
const devCsp: Plugin = {
  name: "vendora-dev-csp",
  apply: "serve",
  transformIndexHtml: (html) =>
    html
      .replace("default-src 'self';", "default-src 'self'; connect-src 'self' ws://localhost:*;")
      .replace("img-src", "script-src 'self' 'unsafe-inline'; img-src"),
};

const shared = resolve(__dirname, "src/shared");

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "backup-worker": resolve(__dirname, "src/main/backup/backup-worker.ts"),
        },
      },
    },
    resolve: { alias: { "@shared": shared } },
  },
  preload: {
    build: { externalizeDeps: { exclude: ["zod"] } },
    resolve: { alias: { "@shared": shared } },
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          receipt: resolve(__dirname, "src/renderer/receipt.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
        "@shared": shared,
      },
    },
    plugins: [react(), tailwindcss(), devCsp],
  },
});
