import { describe, expect, it } from "vitest";
import { parsePrinterForm, printerFormFrom, type PrinterForm } from "./printer-form";

const form = (patch: Partial<PrinterForm> = {}): PrinterForm => ({
  kind: "none",
  windowsName: "",
  host: "",
  port: "9100",
  paperWidthMm: 80,
  printMode: "print",
  ...patch,
});

describe("printerFormFrom", () => {
  it("fills only the fields of the saved connection and defaults the port", () => {
    expect(
      printerFormFrom({
        connection: { kind: "windows", name: "XP-80" },
        paperWidthMm: 58,
        printMode: "ask",
      }),
    ).toEqual(form({ kind: "windows", windowsName: "XP-80", paperWidthMm: 58, printMode: "ask" }));
    expect(
      printerFormFrom({
        connection: { kind: "network", host: "192.168.1.50", port: 9101 },
        paperWidthMm: 80,
        printMode: "off",
      }),
    ).toEqual(form({ kind: "network", host: "192.168.1.50", port: "9101", printMode: "off" }));
    expect(
      printerFormFrom({ connection: { kind: "none" }, paperWidthMm: 80, printMode: "print" }),
    ).toEqual(form());
  });
});

describe("parsePrinterForm", () => {
  it("accepts none without looking at the other fields", () => {
    expect(parsePrinterForm(form({ host: "not valid", port: "x" }))).toEqual({
      ok: true,
      settings: { connection: { kind: "none" }, paperWidthMm: 80, printMode: "print" },
    });
  });

  it("accepts a Windows printer and a network printer", () => {
    expect(parsePrinterForm(form({ kind: "windows", windowsName: " XP-80 " }))).toMatchObject({
      ok: true,
      settings: { connection: { kind: "windows", name: "XP-80" } },
    });
    expect(
      parsePrinterForm(form({ kind: "network", host: "192.168.1.50", port: " 9100 " })),
    ).toMatchObject({
      ok: true,
      settings: { connection: { kind: "network", host: "192.168.1.50", port: 9100 } },
    });
  });

  it("asks for a printer when the Windows name is empty", () => {
    expect(parsePrinterForm(form({ kind: "windows" }))).toEqual({
      ok: false,
      errors: { windowsName: "Pick a printer." },
    });
  });

  it.each(["", "0", "65536", "91.5", "-1", "abc"])("rejects port %j", (port) => {
    expect(parsePrinterForm(form({ kind: "network", host: "10.0.0.5", port }))).toEqual({
      ok: false,
      errors: { port: "Port is 1 to 65535." },
    });
  });

  it("rejects a missing or malformed host", () => {
    expect(parsePrinterForm(form({ kind: "network", host: "" }))).toMatchObject({
      ok: false,
      errors: { host: "Host is required." },
    });
    expect(parsePrinterForm(form({ kind: "network", host: "300.1.1.1" }))).toMatchObject({
      ok: false,
      errors: { host: expect.any(String) },
    });
  });
});
