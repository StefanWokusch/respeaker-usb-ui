import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const __dirname = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts"
      },
      preload: {
        input: "electron/preload.ts"
      }
    })
  ],
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "src/renderer"),
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  build: {
    outDir: "dist"
  }
});
