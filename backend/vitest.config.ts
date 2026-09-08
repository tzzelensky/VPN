import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // TypeScript NodeNext imports use `.js` → map to `.ts` sources under Vitest/Vite
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Hand-rolled unit scripts under src/*.test.ts run via `npm run test:unit` (tsx), not Vitest.
    setupFiles: ["./test/setup-env.ts", "./test/setup-mocks.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
