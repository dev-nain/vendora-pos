import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCheckoutKit, type CheckoutKit } from "../services/checkout-test-kit";
import { createWorkerCopy } from "./worker-copy";

const workerFile = resolve(process.cwd(), "src/main/backup/backup-worker.ts");

const open = (file: string) => new Database(file, { readonly: true, fileMustExist: true });

describe("createWorkerCopy", () => {
  let kit: CheckoutKit;
  let outDir: string;
  const copy = createWorkerCopy(workerFile);

  beforeEach(() => {
    kit = createCheckoutKit();
    outDir = mkdtempSync(join(tmpdir(), "vendora-worker-copy-"));
  });

  afterEach(() => {
    kit.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  const sourceFile = () => kit.database.sqlite.name;

  it("writes a copy that opens read-only and passes integrity_check", async () => {
    const tempFile = join(outDir, "copy.db.tmp");

    const { sizeBytes } = await copy({
      sourceFile: sourceFile(),
      tempFile,
      signal: new AbortController().signal,
    });

    const db = open(tempFile);
    try {
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      db.close();
    }
    expect(sizeBytes).toBeGreaterThan(0);
  });

  it("matches the source row counts", async () => {
    kit.signIn("cashier");
    kit.addProduct();
    const tempFile = join(outDir, "copy.db.tmp");

    await copy({ sourceFile: sourceFile(), tempFile, signal: new AbortController().signal });

    const db = open(tempFile);
    try {
      for (const table of ["products", "users", "stores"]) {
        const count = (conn: { prepare: (sql: string) => { get: () => unknown } }) =>
          conn.prepare(`SELECT count(*) AS n FROM ${table}`).get();
        expect(count(db)).toEqual(count(kit.database.sqlite));
      }
    } finally {
      db.close();
    }
  });

  it("contains a committed shift close", async () => {
    kit.signIn("cashier");
    const shiftId = kit.openShift();
    kit.shifts.close({ shiftId, count: { method: "total", countedCashPaisa: 0 } });
    const tempFile = join(outDir, "copy.db.tmp");

    await copy({ sourceFile: sourceFile(), tempFile, signal: new AbortController().signal });

    const db = open(tempFile);
    try {
      const row = db.prepare("SELECT closed_at FROM shifts WHERE id = ?").get(shiftId) as {
        closed_at: number | null;
      };
      expect(row.closed_at).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("rejects when the target folder is missing", async () => {
    const tempFile = join(outDir, "missing", "copy.db.tmp");

    await expect(
      copy({ sourceFile: sourceFile(), tempFile, signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(existsSync(tempFile)).toBe(false);
  });

  it("rejects when the signal is aborted", async () => {
    const controller = new AbortController();
    const pending = copy({
      sourceFile: sourceFile(),
      tempFile: join(outDir, "copy.db.tmp"),
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});
