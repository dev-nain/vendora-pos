import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { hashRaw } from "@node-rs/argon2";
import { z } from "zod";
import { kdfParamsSchema, type BackupSeal, type KdfParams } from "./backup-cipher";

const defaultKdf: KdfParams = { memoryKiB: 65_536, iterations: 3, parallelism: 1 };
const saltLength = 16;
const checkLabel = "vendora backup password check";

export const unreadableKeyMessage =
  "This PC can't read the backup password. Go to Settings and choose Change password.";

const base64 = z.base64();

const keyRecordSchema = z.strictObject({
  version: z.literal(1),
  kdf: kdfParamsSchema,
  salt: base64,
  check: base64,
  protectedKey: base64,
});
export type BackupKeyRecord = z.infer<typeof keyRecordSchema>;

export type BackupKeyRead =
  | { kind: "off" }
  | { kind: "set"; record: BackupKeyRecord }
  | { kind: "damaged" };

export type BackupKeyState = "off" | "on" | "unreadable";

export interface KeyProtector {
  available(): Promise<boolean>;
  protect(secret: string): Promise<Buffer>;
  unprotect(blob: Buffer): Promise<string>;
}

interface BackupKeyStoreDeps {
  keyFile: string;
  protector: KeyProtector;
  renameFile?: (from: string, to: string) => void;
}

export async function deriveBackupKey(
  password: string,
  salt: Uint8Array,
  kdf: KdfParams,
): Promise<Buffer> {
  return hashRaw(Buffer.from(password.normalize("NFKC"), "utf8"), {
    memoryCost: kdf.memoryKiB,
    timeCost: kdf.iterations,
    parallelism: kdf.parallelism,
    outputLen: 32,
    salt: Buffer.from(salt),
  });
}

function checkTag(key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(checkLabel).digest();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBackupKeyStore({
  keyFile,
  protector,
  renameFile = renameSync,
}: BackupKeyStoreDeps) {
  function read(): BackupKeyRead {
    let text: string;
    try {
      text = readFileSync(keyFile, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { kind: "off" };
      return { kind: "damaged" };
    }
    try {
      return { kind: "set", record: keyRecordSchema.parse(JSON.parse(text)) };
    } catch {
      return { kind: "damaged" };
    }
  }

  async function unlock(record: BackupKeyRecord): Promise<Buffer | null> {
    try {
      const key = Buffer.from(
        await protector.unprotect(Buffer.from(record.protectedKey, "base64")),
        "base64",
      );
      return sameBytes(checkTag(key), Buffer.from(record.check, "base64")) ? key : null;
    } catch {
      return null;
    }
  }

  async function state(): Promise<BackupKeyState> {
    const current = read();
    if (current.kind === "off") return "off";
    if (current.kind === "damaged") return "unreadable";
    return (await unlock(current.record)) ? "on" : "unreadable";
  }

  async function seal(): Promise<BackupSeal | null> {
    const current = read();
    if (current.kind === "off") return null;
    const key = current.kind === "set" ? await unlock(current.record) : null;
    if (current.kind !== "set" || !key) throw new Error(unreadableKeyMessage);
    return { key, salt: Buffer.from(current.record.salt, "base64"), kdf: current.record.kdf };
  }

  async function prepare(password: string): Promise<BackupKeyRecord> {
    const salt = randomBytes(saltLength);
    const key = await deriveBackupKey(password, salt, defaultKdf);
    const protectedKey = await protector.protect(key.toString("base64"));
    return {
      version: 1,
      kdf: defaultKdf,
      salt: salt.toString("base64"),
      check: checkTag(key).toString("base64"),
      protectedKey: protectedKey.toString("base64"),
    };
  }

  async function matches(password: string): Promise<boolean> {
    const current = read();
    if (current.kind !== "set") return false;
    const { record } = current;
    const key = await deriveBackupKey(password, Buffer.from(record.salt, "base64"), record.kdf);
    return sameBytes(checkTag(key), Buffer.from(record.check, "base64"));
  }

  function write(record: BackupKeyRecord): void {
    const tempFile = `${keyFile}.tmp`;
    const descriptor = openSync(tempFile, "w");
    try {
      writeSync(descriptor, JSON.stringify(record));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      renameFile(tempFile, keyFile);
    } catch (cause) {
      rmSync(tempFile, { force: true });
      throw cause;
    }
  }

  function remove(): void {
    rmSync(keyFile, { force: true });
  }

  return {
    read,
    state,
    seal,
    available: () => protector.available(),
    prepare,
    matches,
    write,
    remove,
  };
}

export type BackupKeyStore = ReturnType<typeof createBackupKeyStore>;
