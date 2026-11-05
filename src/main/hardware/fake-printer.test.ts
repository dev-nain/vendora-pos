import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePrinter } from "./fake-printer";
import { createTransport } from "./printer-transport";

describe("createFakePrinter", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-fake-printer-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the exact bytes and the preview, creating the folder", async () => {
    const target = join(dir, "nested", "prints");
    const fake = createFakePrinter(target, () => new Date(2026, 10, 4, 16, 5, 9));

    const result = await fake.send({
      kind: "receipt",
      bytes: Uint8Array.of(0x1b, 0x40),
      previewPng: Buffer.from("png"),
    });

    expect(result.successful).toBe(true);
    expect(readdirSync(target).toSorted()).toEqual([
      "20261104-160509-1-receipt.bin",
      "20261104-160509-1-receipt.png",
    ]);
    expect([...readFileSync(join(target, "20261104-160509-1-receipt.bin"))]).toEqual([0x1b, 0x40]);
  });

  it("numbers jobs and skips the png when there is no preview", async () => {
    const fake = createFakePrinter(dir, () => new Date(2026, 0, 2, 3, 4, 5));

    await fake.send({ kind: "report", bytes: Uint8Array.of(1) });
    await fake.send({ kind: "test", bytes: Uint8Array.of(2) });

    expect(readdirSync(dir).toSorted()).toEqual([
      "20260102-030405-1-report.bin",
      "20260102-030405-2-test.bin",
    ]);
  });

  it("logs drawer kicks to drawer.log and writes no job file", async () => {
    const fake = createFakePrinter(dir, () => new Date("2026-11-04T10:00:00.000Z"));

    await fake.send({ kind: "drawer", bytes: Uint8Array.of(0x1b, 0x70), reason: "cash_in" });
    await fake.send({ kind: "drawer", bytes: Uint8Array.of(0x1b, 0x70), reason: "sale" });

    expect(readdirSync(dir)).toEqual(["drawer.log"]);
    expect(readFileSync(join(dir, "drawer.log"), "utf8")).toBe(
      "2026-11-04T10:00:00.000Z kick pin2 cash_in\n2026-11-04T10:00:00.000Z kick pin2 sale\n",
    );
  });

  it("fails once after failNext and then recovers", async () => {
    const fake = createFakePrinter(dir);
    fake.failNext();

    const first = await fake.send({ kind: "receipt", bytes: Uint8Array.of(1) });
    const second = await fake.send({ kind: "receipt", bytes: Uint8Array.of(1) });

    expect(first).toMatchObject({ successful: false, canRetry: true });
    expect(second.successful).toBe(true);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("never throws when the folder can't be written", async () => {
    const fake = createFakePrinter(join(dir, "file\0bad"));

    const result = await fake.send({ kind: "receipt", bytes: Uint8Array.of(1) });

    expect(result.successful).toBe(false);
  });
});

describe("createTransport", () => {
  const none = { kind: "none" } as const;

  it("uses the fake printer only when unpackaged", () => {
    expect(createTransport(none, { fakePrinterDir: "/tmp/x", isPackaged: false })).not.toBeNull();
    expect(createTransport(none, { fakePrinterDir: "/tmp/x", isPackaged: true })).toBeNull();
  });

  it("returns null for no printer and a transport for the configured kinds", () => {
    const env = { fakePrinterDir: undefined, isPackaged: true };

    expect(createTransport(none, env)).toBeNull();
    expect(createTransport({ kind: "windows", name: "XP-80" }, env)).not.toBeNull();
    expect(createTransport({ kind: "network", host: "10.0.0.5", port: 9100 }, env)).not.toBeNull();
  });
});
