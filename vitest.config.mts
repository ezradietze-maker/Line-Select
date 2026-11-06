import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Other sessions' worktrees (with their own copies of every test) and scratch folders aren't this checkout's tests.
    exclude: [...configDefaults.exclude, ".claude/**", ".cache/**", "private/**"],
  },
});
