import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { printerMessages, type PrintResult } from "../../shared/receipt";
import { printSucceeded } from "./print-result";
import type { PrintJob, PrinterTransport } from "./printer-transport";

export interface FakePrinter extends PrinterTransport {
  failNext(): void;
}

const pad = (value: number) => String(value).padStart(2, "0");

function stamp(date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function createFakePrinter(dir: string, now: () => Date = () => new Date()): FakePrinter {
  let counter = 0;
  let failing = false;

  return {
    failNext() {
      failing = true;
    },
    async send(job: PrintJob): Promise<PrintResult> {
      if (failing) {
        failing = false;
        return { successful: false, canRetry: true, message: printerMessages.offline };
      }
      try {
        mkdirSync(dir, { recursive: true });
        const at = now();
        if (job.kind === "drawer") {
          appendFileSync(
            join(dir, "drawer.log"),
            `${at.toISOString()} kick pin2 ${job.reason ?? "unknown"}\n`,
          );
          return printSucceeded;
        }
        counter += 1;
        const base = join(dir, `${stamp(at)}-${counter}-${job.kind}`);
        writeFileSync(`${base}.bin`, job.bytes);
        if (job.previewPng) writeFileSync(`${base}.png`, job.previewPng);
        return printSucceeded;
      } catch {
        return { successful: false, canRetry: true, message: printerMessages.offline };
      }
    },
  };
}
