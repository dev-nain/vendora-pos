import { rename, rm, writeFile } from "node:fs/promises";

export async function writeAtomic(path: string, bytes: Buffer): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
