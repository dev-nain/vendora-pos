import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const electron = require("electron");
const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const args = process.argv.slice(2);
const bench = args.includes("--bench");

const result = spawnSync(electron, [vitest, "run", ...args.filter((arg) => arg !== "--bench")], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(bench && { VENDORA_BENCH: "1" }) },
});

process.exit(result.status ?? 1);
