import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/services/import-parser-worker.ts"],
  format: ["cjs"],
  target: "node22",
  outDir: "dist",
  clean: true,
  shims: true,
  noExternal: ["@douyin-admin/shared"]
});
