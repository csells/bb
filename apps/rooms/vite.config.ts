import { defineConfig } from "vite";
export default defineConfig({
  resolve: { conditions: ["source"] },
  build: { outDir: "dist/web" },
  server: { host: "127.0.0.1" },
});
