import { printerConnectionSchema, type PaperWidthMm, type PrinterSettings } from "@shared/settings";

export const DEFAULT_PORT = "9100";

export interface PrinterForm {
  kind: PrinterSettings["connection"]["kind"];
  windowsName: string;
  host: string;
  port: string;
  paperWidthMm: PaperWidthMm;
  printMode: PrinterSettings["printMode"];
}

export interface PrinterFormErrors {
  windowsName?: string;
  host?: string;
  port?: string;
}

export function printerFormFrom(settings: PrinterSettings): PrinterForm {
  const { connection } = settings;
  return {
    kind: connection.kind,
    windowsName: connection.kind === "windows" ? connection.name : "",
    host: connection.kind === "network" ? connection.host : "",
    port: connection.kind === "network" ? String(connection.port) : DEFAULT_PORT,
    paperWidthMm: settings.paperWidthMm,
    printMode: settings.printMode,
  };
}

export function parsePrinterForm(
  form: PrinterForm,
): { ok: true; settings: PrinterSettings } | { ok: false; errors: PrinterFormErrors } {
  const candidate =
    form.kind === "windows"
      ? { kind: "windows", name: form.windowsName }
      : form.kind === "network"
        ? {
            kind: "network",
            host: form.host,
            port: /^\d{1,5}$/.test(form.port.trim()) ? Number(form.port.trim()) : Number.NaN,
          }
        : { kind: "none" };
  const parsed = printerConnectionSchema.safeParse(candidate);
  if (parsed.success) {
    return {
      ok: true,
      settings: {
        connection: parsed.data,
        paperWidthMm: form.paperWidthMm,
        printMode: form.printMode,
      },
    };
  }
  const errors: PrinterFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "name") errors.windowsName ??= issue.message;
    else if (field === "host") errors.host ??= issue.message;
    else if (field === "port") errors.port = "Port is 1 to 65535.";
  }
  return { ok: false, errors };
}
