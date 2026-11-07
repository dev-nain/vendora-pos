import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const benchmarks = "src/**/*-benchmark.test.ts";
const bench = process.env.VENDORA_BENCH === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer/src"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: bench ? [benchmarks] : ["src/**/*.test.ts"],
    exclude: bench ? configDefaults.exclude : [...configDefaults.exclude, benchmarks],
    // Timing tests run alone so other test files don't compete for the CPU.
    fileParallelism: !bench,
  },
});
