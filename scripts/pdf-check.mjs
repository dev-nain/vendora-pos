import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const electron = require("electron");

const dir = mkdtempSync(join(tmpdir(), "vendora-pdf-"));
const file = join(dir, "check.pdf");
const env = { ...process.env, VENDORA_PDF_CHECK: file };
delete env.ELECTRON_RUN_AS_NODE;

function fail(message) {
  rmSync(dir, { recursive: true, force: true });
  console.error(`PDF check failed: ${message}`);
  process.exit(1);
}

const result = spawnSync(electron, ["."], { stdio: "inherit", timeout: 60_000, env });

if (result.error) fail(result.error.message);
if (result.status !== 0) fail(`electron exited with ${result.status}`);

let bytes;
try {
  bytes = readFileSync(file);
} catch {
  fail("no file was written");
}
if (bytes.length <= 1024) fail(`file is only ${bytes.length} bytes`);
if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") fail("file does not start with %PDF-");
if (!bytes.subarray(-32).toString("latin1").includes("%%EOF")) fail("file has no %%EOF trailer");

rmSync(dir, { recursive: true, force: true });
console.log(`PDF check passed (${bytes.length} bytes)`);
