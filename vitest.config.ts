import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "components/**/*.test.ts", "lib/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    // Mirror the tsconfig "@/*" path alias.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
