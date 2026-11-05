import type { PrintResult } from "../../shared/receipt";
import { printOffline, printSucceeded, printerNotFound } from "./print-result";
import type { PrintJob, PrinterTransport } from "./printer-transport";
import { interpretSpoolerStatus, isJobDone } from "./spooler-status";

const jobWatchMs = 8000;
const jobPollMs = 100;
const jobControlDelete = 5;
const printerInfoLevel = 2;
const jobInfoLevel = 1;

interface Winspool {
  open(name: string): unknown;
  close(handle: unknown): void;
  status(handle: unknown): { status: number; attributes: number } | null;
  jobStatus(handle: unknown, jobId: number): number | null;
  cancelJob(handle: unknown, jobId: number): void;
  write(handle: unknown, bytes: Uint8Array): number | null;
  endDocument(handle: unknown): void;
  startDocument(handle: unknown, title: string): number;
}

let winspool: Promise<Winspool> | undefined;

function readInfo(
  fetch: (buffer: Buffer | null, size: number, needed: number[]) => boolean,
): Buffer | null {
  const needed = [0];
  fetch(null, 0, needed);
  const size = needed[0] ?? 0;
  if (size === 0) return null;
  const buffer = Buffer.alloc(size);
  return fetch(buffer, size, [0]) ? buffer : null;
}

async function loadWinspool(): Promise<Winspool> {
  const koffi = await import("koffi");
  const lib = koffi.load("winspool.drv");
  koffi.pointer("PRINTER_HANDLE", koffi.opaque());
  koffi.struct("DOC_INFO_1W", { pDocName: "str16", pOutputFile: "str16", pDatatype: "str16" });
  const OpenPrinterW = lib.func(
    "bool __stdcall OpenPrinterW(str16 name, _Out_ PRINTER_HANDLE *handle, void *defaults)",
  );
  const ClosePrinter = lib.func("bool __stdcall ClosePrinter(PRINTER_HANDLE handle)");
  const StartDocPrinterW = lib.func(
    "uint32 __stdcall StartDocPrinterW(PRINTER_HANDLE handle, uint32 level, DOC_INFO_1W *info)",
  );
  const EndDocPrinter = lib.func("bool __stdcall EndDocPrinter(PRINTER_HANDLE handle)");
  const StartPagePrinter = lib.func("bool __stdcall StartPagePrinter(PRINTER_HANDLE handle)");
  const EndPagePrinter = lib.func("bool __stdcall EndPagePrinter(PRINTER_HANDLE handle)");
  const WritePrinter = lib.func(
    "bool __stdcall WritePrinter(PRINTER_HANDLE handle, void *data, uint32 size, _Out_ uint32 *written)",
  );
  const GetPrinterW = lib.func(
    "bool __stdcall GetPrinterW(PRINTER_HANDLE handle, uint32 level, void *buffer, uint32 size, _Out_ uint32 *needed)",
  );
  const GetJobW = lib.func(
    "bool __stdcall GetJobW(PRINTER_HANDLE handle, uint32 jobId, uint32 level, void *buffer, uint32 size, _Out_ uint32 *needed)",
  );
  const SetJobW = lib.func(
    "bool __stdcall SetJobW(PRINTER_HANDLE handle, uint32 jobId, uint32 level, void *job, uint32 command)",
  );

  const pointerSize = koffi.sizeof("void *");
  const printerAttributesAt = 13 * pointerSize;
  const printerStatusAt = printerAttributesAt + 5 * 4;
  const jobStatusAt = 7 * pointerSize;

  return {
    open(name) {
      const out: unknown[] = [null];
      return OpenPrinterW(name, out, null) ? out[0] : null;
    },
    close(handle) {
      ClosePrinter(handle);
    },
    status(handle) {
      const buffer = readInfo((buf, size, needed) =>
        GetPrinterW(handle, printerInfoLevel, buf, size, needed),
      );
      if (!buffer) return null;
      return {
        attributes: buffer.readUInt32LE(printerAttributesAt),
        status: buffer.readUInt32LE(printerStatusAt),
      };
    },
    jobStatus(handle, jobId) {
      const buffer = readInfo((buf, size, needed) =>
        GetJobW(handle, jobId, jobInfoLevel, buf, size, needed),
      );
      return buffer ? buffer.readUInt32LE(jobStatusAt) : null;
    },
    cancelJob(handle, jobId) {
      SetJobW(handle, jobId, 0, null, jobControlDelete);
    },
    startDocument(handle, title) {
      const jobId = StartDocPrinterW(handle, 1, {
        pDocName: title,
        pOutputFile: null,
        pDatatype: "RAW",
      }) as number;
      if (jobId !== 0) StartPagePrinter(handle);
      return jobId;
    },
    write(handle, bytes) {
      const written = [0];
      return WritePrinter(handle, Buffer.from(bytes), bytes.length, written)
        ? (written[0] ?? 0)
        : null;
    },
    endDocument(handle) {
      EndPagePrinter(handle);
      EndDocPrinter(handle);
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function watchJob(api: Winspool, handle: unknown, jobId: number): Promise<PrintResult> {
  const deadline = Date.now() + jobWatchMs;
  for (;;) {
    const jobStatus = api.jobStatus(handle, jobId);
    if (jobStatus === null) return printSucceeded;
    const printer = api.status(handle);
    if (isJobDone(jobStatus)) return printSucceeded;
    const verdict = interpretSpoolerStatus(
      printer?.status ?? 0,
      printer?.attributes ?? 0,
      jobStatus,
    );
    if (verdict.state === "failed" || Date.now() >= deadline) {
      api.cancelJob(handle, jobId);
      return printOffline;
    }
    await sleep(jobPollMs);
  }
}

async function sendRaw(name: string, job: PrintJob): Promise<PrintResult> {
  winspool ??= loadWinspool();
  const api = await winspool;
  const handle = api.open(name);
  if (!handle) return printerNotFound;
  try {
    const before = api.status(handle);
    if (
      before &&
      interpretSpoolerStatus(before.status, before.attributes, null).state === "failed"
    ) {
      return printOffline;
    }
    const jobId = api.startDocument(handle, "Vendora");
    if (jobId === 0) return printOffline;
    const written = api.write(handle, job.bytes);
    api.endDocument(handle);
    if (written !== job.bytes.length) {
      api.cancelJob(handle, jobId);
      return printOffline;
    }
    return await watchJob(api, handle, jobId);
  } finally {
    api.close(handle);
  }
}

export function createWindowsTransport(name: string): PrinterTransport {
  return {
    async send(job) {
      if (process.platform !== "win32") return printOffline;
      try {
        return await sendRaw(name, job);
      } catch {
        return printOffline;
      }
    },
  };
}
