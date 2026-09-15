import { defineConfig } from "vitest/config";

const containers = process.env.TEST_CONTAINERS === "1";

export default defineConfig({
  resolve: {
    // TypeScript NodeNext imports use `.js` → map to `.ts` sources under Vitest/Vite
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    include: containers ? ["test/containers/**/*.test.ts"] : ["test/api/**/*.test.ts"],
    // Hand-rolled unit scripts under src/*.test.ts run via `npm run test:unit` (tsx), not Vitest.
    setupFiles: containers ? [] : ["./test/setup-env.ts", "./test/setup-mocks.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: containers ? 120_000 : 30_000,
    hookTimeout: containers ? 120_000 : 30_000,
  },
});
