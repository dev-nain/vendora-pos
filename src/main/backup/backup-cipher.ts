import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, openSync, readSync, writeSync } from "node:fs";
import { open } from "node:fs/promises";
import { z } from "zod";

const magic = Buffer.from("VNDBKENC", "ascii");
const formatVersion = 1;
const passwordSaltLength = 16;
const fileSaltLength = 32;
const ivLength = 12;
const tagLength = 16;
const headerLength = 78;
const chunkSize = 1024 * 1024;
const fileKeyInfo = "vendora backup file v1";

export const kdfParamsSchema = z.strictObject({
  memoryKiB: z.int().min(8).max(1_048_576),
  iterations: z.int().min(1).max(16),
  parallelism: z.int().min(1).max(8),
});
export type KdfParams = z.infer<typeof kdfParamsSchema>;

export interface BackupSeal {
  key: Uint8Array;
  salt: Uint8Array;
  kdf: KdfParams;
}

export interface BackupHeader {
  kdf: KdfParams;
  passwordSalt: Buffer;
  fileSalt: Buffer;
  iv: Buffer;
  bytes: Buffer;
}

export type BackupHeaderResult =
  | { ok: true; header: BackupHeader }
  | { ok: false; reason: "corrupt" | "newer-version" };

function fileKey(key: Uint8Array, fileSalt: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", key, fileSalt, fileKeyInfo, 32));
}

function encodeHeader(seal: BackupSeal, fileSalt: Buffer, iv: Buffer): Buffer {
  const header = Buffer.alloc(headerLength);
  magic.copy(header, 0);
  header.writeUInt8(formatVersion, 8);
  header.writeUInt32BE(seal.kdf.memoryKiB, 9);
  header.writeUInt32BE(seal.kdf.iterations, 13);
  header.writeUInt8(seal.kdf.parallelism, 17);
  Buffer.from(seal.salt).copy(header, 18);
  fileSalt.copy(header, 18 + passwordSaltLength);
  iv.copy(header, 18 + passwordSaltLength + fileSaltLength);
  return header;
}

function decodeHeader(bytes: Buffer): BackupHeaderResult {
  if (!bytes.subarray(0, magic.length).equals(magic)) return { ok: false, reason: "corrupt" };
  if (bytes.readUInt8(8) !== formatVersion) return { ok: false, reason: "newer-version" };
  const kdf = kdfParamsSchema.safeParse({
    memoryKiB: bytes.readUInt32BE(9),
    iterations: bytes.readUInt32BE(13),
    parallelism: bytes.readUInt8(17),
  });
  if (!kdf.success) return { ok: false, reason: "corrupt" };
  const saltEnd = 18 + passwordSaltLength;
  const fileSaltEnd = saltEnd + fileSaltLength;
  return {
    ok: true,
    header: {
      kdf: kdf.data,
      passwordSalt: bytes.subarray(18, saltEnd),
      fileSalt: bytes.subarray(saltEnd, fileSaltEnd),
      iv: bytes.subarray(fileSaltEnd, fileSaltEnd + ivLength),
      bytes,
    },
  };
}

export async function isEncryptedBackup(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(magic.length);
    const { bytesRead } = await handle.read(head, 0, magic.length, 0);
    return bytesRead === magic.length && head.equals(magic);
  } finally {
    await handle.close();
  }
}

export async function readBackupHeader(file: string): Promise<BackupHeaderResult> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const bytes = Buffer.alloc(headerLength);
    const { bytesRead } = await handle.read(bytes, 0, headerLength, 0);
    if (bytesRead < headerLength || size < headerLength + tagLength) {
      return { ok: false, reason: "corrupt" };
    }
    return decodeHeader(bytes);
  } finally {
    await handle.close();
  }
}

export function sealedTempFile(tempFile: string): string {
  return tempFile.replace(/\.tmp$/, ".sealed.tmp");
}

export function sealBackupFile(plainFile: string, sealedFile: string, seal: BackupSeal): void {
  const fileSalt = randomBytes(fileSaltLength);
  const iv = randomBytes(ivLength);
  const header = encodeHeader(seal, fileSalt, iv);
  const cipher = createCipheriv("aes-256-gcm", fileKey(seal.key, fileSalt), iv);
  cipher.setAAD(header);

  const input = openSync(plainFile, "r");
  try {
    const output = openSync(sealedFile, "w");
    try {
      writeSync(output, header);
      const buffer = Buffer.alloc(chunkSize);
      for (;;) {
        const read = readSync(input, buffer, 0, chunkSize, null);
        if (read === 0) break;
        writeSync(output, cipher.update(buffer.subarray(0, read)));
      }
      writeSync(output, cipher.final());
      writeSync(output, cipher.getAuthTag());
      fsyncSync(output);
    } finally {
      closeSync(output);
    }
  } finally {
    closeSync(input);
  }
}

export async function openBackupFile(
  sourceFile: string,
  targetFile: string,
  header: BackupHeader,
  key: Uint8Array,
): Promise<boolean> {
  const source = await open(sourceFile, "r");
  try {
    const { size } = await source.stat();
    const tag = Buffer.alloc(tagLength);
    await source.read(tag, 0, tagLength, size - tagLength);

    const decipher = createDecipheriv("aes-256-gcm", fileKey(key, header.fileSalt), header.iv);
    decipher.setAAD(header.bytes);
    decipher.setAuthTag(tag);

    const target = await open(targetFile, "w");
    try {
      const buffer = Buffer.alloc(chunkSize);
      let position = headerLength;
      const end = size - tagLength;
      while (position < end) {
        const length = Math.min(chunkSize, end - position);
        const { bytesRead } = await source.read(buffer, 0, length, position);
        if (bytesRead === 0) break;
        position += bytesRead;
        await target.write(decipher.update(buffer.subarray(0, bytesRead)));
      }
      if (!finishes(decipher)) return false;
      await target.sync();
      return true;
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}

function finishes(decipher: ReturnType<typeof createDecipheriv>): boolean {
  try {
    decipher.final();
    return true;
  } catch {
    return false;
  }
}
