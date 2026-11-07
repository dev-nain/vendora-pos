import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isEncryptedBackup,
  openBackupFile,
  readBackupHeader,
  sealBackupFile,
  sealedTempFile,
  type BackupHeader,
  type BackupSeal,
} from "./backup-cipher";

const sqliteHeader = Buffer.from("SQLite format 3\0", "latin1");

let dir: string;
let seal: BackupSeal;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vendora-cipher-"));
  seal = {
    key: randomBytes(32),
    salt: randomBytes(16),
    kdf: { memoryKiB: 64, iterations: 1, parallelism: 1 },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function plainFile(size: number): { file: string; bytes: Buffer } {
  const bytes = Buffer.concat([sqliteHeader, randomBytes(size - sqliteHeader.length)]);
  const file = join(dir, "plain.db");
  writeFileSync(file, bytes);
  return { file, bytes };
}

function sealed(size: number): { file: string; bytes: Buffer } {
  const plain = plainFile(size);
  const file = join(dir, "sealed.db");
  sealBackupFile(plain.file, file, seal);
  return { file, bytes: plain.bytes };
}

async function headerOf(file: string): Promise<BackupHeader> {
  const result = await readBackupHeader(file);
  if (!result.ok) throw new Error(result.reason);
  return result.header;
}

async function unseal(file: string, key: Uint8Array = seal.key): Promise<boolean> {
  return openBackupFile(file, join(dir, "out.db"), await headerOf(file), key);
}

describe("backup cipher", () => {
  it.each([3 * 1024 * 1024 + 123, 500])("round trips a file of %i bytes", async (size) => {
    const { file, bytes } = sealed(size);

    expect(await unseal(file)).toBe(true);

    expect(readFileSync(join(dir, "out.db")).equals(bytes)).toBe(true);
  });

  it("hides the input bytes and the sqlite header", () => {
    const { file, bytes } = sealed(4096);
    const out = readFileSync(file);

    expect(out.includes(sqliteHeader)).toBe(false);
    expect(out.includes(bytes.subarray(100, 140))).toBe(false);
    expect(out.subarray(0, 8).toString("ascii")).toBe("VNDBKENC");
  });

  it("gives different output for two seals of one file", () => {
    const plain = plainFile(4096);
    sealBackupFile(plain.file, join(dir, "a.db"), seal);
    sealBackupFile(plain.file, join(dir, "b.db"), seal);

    expect(readFileSync(join(dir, "a.db")).equals(readFileSync(join(dir, "b.db")))).toBe(false);
  });

  it("detects encryption from the magic bytes only", async () => {
    expect(await isEncryptedBackup(sealed(4096).file)).toBe(true);
    expect(await isEncryptedBackup(plainFile(4096).file)).toBe(false);
  });

  it("returns false for a wrong key", async () => {
    const { file } = sealed(4096);

    expect(await unseal(file, randomBytes(32))).toBe(false);
  });

  it.each([
    ["header", 20],
    ["ciphertext", 200],
    ["tag", -3],
  ])("returns false when a byte in the %s changes", async (_part, offset) => {
    const { file } = sealed(4096);
    const bytes = readFileSync(file);
    const at = offset < 0 ? bytes.length + offset : offset;
    bytes[at] = (bytes[at] ?? 0) ^ 0xff;
    writeFileSync(file, bytes);

    const result = await readBackupHeader(file);
    if (!result.ok) {
      expect(result.reason).toBe("corrupt");
      return;
    }
    expect(await openBackupFile(file, join(dir, "out.db"), result.header, seal.key)).toBe(false);
  });

  it("rejects a truncated file", async () => {
    const { file } = sealed(4096);
    truncateSync(file, 4000);

    expect(await unseal(file)).toBe(false);
  });

  it("rejects an appended file", async () => {
    const { file } = sealed(4096);
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("extra")]));

    expect(await unseal(file)).toBe(false);
  });

  it("calls a file shorter than a header and tag corrupt", async () => {
    const file = join(dir, "short.db");
    writeFileSync(file, Buffer.from("VNDBKENC"));

    expect(await readBackupHeader(file)).toEqual({ ok: false, reason: "corrupt" });
  });

  it.each([
    ["memory", 9, 0xffffffff],
    ["memory low", 9, 0],
    ["passes", 13, 99],
  ])("calls out-of-range %s corrupt", async (_name, offset, value) => {
    const { file } = sealed(4096);
    const bytes = readFileSync(file);
    bytes.writeUInt32BE(value, offset);
    writeFileSync(file, bytes);

    expect(await readBackupHeader(file)).toEqual({ ok: false, reason: "corrupt" });
  });

  it("calls an out-of-range parallelism corrupt", async () => {
    const { file } = sealed(4096);
    const bytes = readFileSync(file);
    bytes.writeUInt8(0, 17);
    writeFileSync(file, bytes);

    expect(await readBackupHeader(file)).toEqual({ ok: false, reason: "corrupt" });
  });

  it("calls an unknown version newer", async () => {
    const { file } = sealed(4096);
    const bytes = readFileSync(file);
    bytes.writeUInt8(2, 8);
    writeFileSync(file, bytes);

    expect(await readBackupHeader(file)).toEqual({ ok: false, reason: "newer-version" });
  });

  it("throws on a read error instead of reporting a wrong password", async () => {
    const { file } = sealed(4096);
    const header = await headerOf(file);

    await expect(
      openBackupFile(file, join(dir, "missing-folder", "out.db"), header, seal.key),
    ).rejects.toThrow();
  });

  it("names the sealed temp file beside the temp file", () => {
    expect(sealedTempFile("/x/vendora-a.db.tmp")).toBe("/x/vendora-a.db.sealed.tmp");
  });
});
