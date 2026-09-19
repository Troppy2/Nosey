import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * The opt-in System Design integration suite: the tests that boot a real Python
 * runtime. They are excluded from `npm test` (they skip themselves unless
 * SD_PYODIDE_TESTS is set) so the default suite stays fast and offline.
 *
 * Run with: npm run test:pyodide
 * Requires the `pyodide` npm package to be installed as a devDependency.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    env: { SD_PYODIDE_TESTS: "1" },
    testTimeout: 120_000,
    hookTimeout: 180_000,
    include: [
      "src/lib/pyodideRunner.multifile.test.ts",
      "src/data/systemDesign/**/solution.test.ts",
    ],
  },
});
