import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackupKeyStore,
  deriveBackupKey,
  unreadableKeyMessage,
  type BackupKeyRecord,
  type KeyProtector,
} from "./backup-key";

const smallKdf = { memoryKiB: 64, iterations: 1, parallelism: 1 };

let dir: string;
let keyFile: string;
let protectorFails: boolean;
let protectorAvailable: boolean;

const protector: KeyProtector = {
  available: async () => protectorAvailable,
  protect: async (secret) => Buffer.from(secret.split("").toReversed().join(""), "utf8"),
  unprotect: async (blob) => {
    if (protectorFails) throw new Error("no keyring");
    return blob.toString("utf8").split("").toReversed().join("");
  },
};

function store(renameFile?: (from: string, to: string) => void) {
  return createBackupKeyStore({ keyFile, protector, ...(renameFile ? { renameFile } : {}) });
}

async function preparedRecord(password: string): Promise<BackupKeyRecord> {
  const record = await store().prepare(password);
  return { ...record, kdf: smallKdf };
}

async function turnOn(password: string): Promise<void> {
  const keys = store();
  const prepared = await keys.prepare(password);
  keys.write(prepared);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vendora-key-"));
  keyFile = join(dir, "backup-key.json");
  protectorFails = false;
  protectorAvailable = true;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backup key derivation", () => {
  it("matches a fixed vector", async () => {
    const salt = Buffer.from(Array.from({ length: 16 }, (_, index) => index));

    const key = await deriveBackupKey("correct horse battery staple", salt, {
      memoryKiB: 64,
      iterations: 2,
      parallelism: 1,
    });

    expect(key.toString("hex")).toBe(
      "2df47ede6358ed17a9976d4fcedb897a10036d432a4acef17d263bfc98bd20ac",
    );
  });

  it("derives one key from the composed and decomposed forms of a password", async () => {
    const salt = Buffer.alloc(16, 7);

    const composed = await deriveBackupKey("café au lait", salt, smallKdf);
    const decomposed = await deriveBackupKey("café au lait", salt, smallKdf);

    expect(composed.equals(decomposed)).toBe(true);
  });
});

describe("backup key store", () => {
  it("is off when there is no key file", async () => {
    const keys = store();

    expect(keys.read()).toEqual({ kind: "off" });
    expect(await keys.state()).toBe("off");
    expect(await keys.seal()).toBeNull();
    expect(await keys.matches("anything goes")).toBe(false);
  });

  it("is on after a record is written, and seals with the stored key", async () => {
    await turnOn("blue horse 7");
    const keys = store();

    expect(await keys.state()).toBe("on");
    const seal = await keys.seal();
    const record = keys.read();
    if (!seal || record.kind !== "set") throw new Error("expected a seal");
    expect(Buffer.from(seal.salt).toString("base64")).toBe(record.record.salt);
    expect(seal.kdf).toEqual(record.record.kdf);
    expect(
      Buffer.from(seal.key).equals(await deriveBackupKey("blue horse 7", seal.salt, seal.kdf)),
    ).toBe(true);
  });

  it("uses a new salt for each prepared record", async () => {
    const keys = store();

    const first = await keys.prepare("blue horse 7");
    const second = await keys.prepare("blue horse 7");

    expect(first.salt).not.toBe(second.salt);
  });

  it("is unreadable when the protector throws, and seal throws the recovery text", async () => {
    await turnOn("blue horse 7");
    protectorFails = true;
    const keys = store();

    expect(await keys.state()).toBe("unreadable");
    await expect(keys.seal()).rejects.toThrow(unreadableKeyMessage);
  });

  it("is unreadable when the unprotected key does not match the check", async () => {
    await turnOn("blue horse 7");
    const record = JSON.parse(readFileSync(keyFile, "utf8")) as BackupKeyRecord;
    writeFileSync(
      keyFile,
      JSON.stringify({
        ...record,
        protectedKey: Buffer.from("not the key", "utf8").toString("base64"),
      }),
    );

    expect(await store().state()).toBe("unreadable");
  });

  it.each(["not json", "{}", JSON.stringify({ version: 2 })])(
    "is unreadable for a damaged key file %s",
    async (text) => {
      writeFileSync(keyFile, text);
      const keys = store();

      expect(keys.read()).toEqual({ kind: "damaged" });
      expect(await keys.state()).toBe("unreadable");
      await expect(keys.seal()).rejects.toThrow(unreadableKeyMessage);
    },
  );

  it("checks the password without reading the protected key", async () => {
    await turnOn("blue horse 7");
    protectorFails = true;
    const keys = store();

    expect(await keys.matches("blue horse 7")).toBe(true);
    expect(await keys.matches("blue horse 8")).toBe(false);
  });

  it("keeps the raw password and the raw key out of the key file", async () => {
    await turnOn("blue horse 7");
    const text = readFileSync(keyFile, "utf8");
    const seal = await store().seal();

    expect(text).not.toContain("blue horse 7");
    expect(text).not.toContain(Buffer.from(seal?.key ?? []).toString("base64"));
    expect(text).not.toContain(Buffer.from(seal?.key ?? []).toString("hex"));
  });

  it("leaves the old file when the rename fails", async () => {
    await turnOn("blue horse 7");
    const before = readFileSync(keyFile, "utf8");
    const next = await preparedRecord("green horse 8");

    expect(() =>
      store(() => {
        throw new Error("rename failed");
      }).write(next),
    ).toThrow("rename failed");

    expect(readFileSync(keyFile, "utf8")).toBe(before);
  });

  it("removes the key file and tolerates a missing one", async () => {
    await turnOn("blue horse 7");
    const keys = store();

    keys.remove();
    keys.remove();

    expect(keys.read()).toEqual({ kind: "off" });
  });

  it("reports whether the protector is available", async () => {
    protectorAvailable = false;

    expect(await store().available()).toBe(false);
  });
});
