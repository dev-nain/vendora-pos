import type { PrintResult } from "../../shared/receipt";
import type { PrinterConnection } from "../../shared/settings";
import { createFakePrinter } from "./fake-printer";
import { createNetworkTransport } from "./network-printer";
import { createWindowsTransport } from "./windows-spooler";

export type PrintJobKind = "receipt" | "report" | "test" | "drawer";

export interface PrintJob {
  kind: PrintJobKind;
  bytes: Uint8Array;
  previewPng?: Buffer;
  reason?: string;
}

export interface PrinterTransport {
  send(job: PrintJob): Promise<PrintResult>;
}

export interface TransportEnv {
  fakePrinterDir: string | undefined;
  isPackaged: boolean;
}

const fakePrinters = new Map<string, ReturnType<typeof createFakePrinter>>();

export function fakePrinterFor(dir: string): ReturnType<typeof createFakePrinter> {
  let fake = fakePrinters.get(dir);
  if (!fake) {
    fake = createFakePrinter(dir);
    fakePrinters.set(dir, fake);
  }
  return fake;
}

export function createTransport(
  connection: PrinterConnection,
  env: TransportEnv,
): PrinterTransport | null {
  if (env.fakePrinterDir && !env.isPackaged) return fakePrinterFor(env.fakePrinterDir);
  if (connection.kind === "windows") return createWindowsTransport(connection.name);
  if (connection.kind === "network")
    return createNetworkTransport(connection.host, connection.port);
  return null;
}
