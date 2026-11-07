import { rename, rm, writeFile } from "node:fs/promises";
import type { DocumentPanel } from "../../shared/document";
import type { ReceiptSettings } from "../../shared/settings";

const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export const present = (value: string | null): value is string =>
  value !== null && value.trim() !== "";

export function labelled(label: string, value: string | null): string[] {
  return present(value) ? [`${label}: ${value}`] : [];
}

export function storePanel(store: ReceiptSettings): DocumentPanel {
  return {
    lines: [
      ...(present(store.name) ? [store.name] : []),
      ...(present(store.address) ? [store.address] : []),
      ...labelled("Phone", store.phone),
      ...labelled("NTN", store.ntn),
      ...labelled("STRN", store.strn),
    ],
  };
}

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
