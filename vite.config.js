import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        demo: fileURLToPath(new URL("./index.html", import.meta.url)),
        vault: fileURLToPath(new URL("./vault.html", import.meta.url)),
      },
    },
  },
});
