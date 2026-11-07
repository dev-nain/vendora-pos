import { describe, expect, it } from "vitest";
import { invoiceShortcut } from "./invoice-shortcut";

const press = (key: string, patch: Partial<Parameters<typeof invoiceShortcut>[0]> = {}) => ({
  key,
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
  ...patch,
});

describe("invoiceShortcut", () => {
  it.each([
    ["P", "print"],
    ["p", "print"],
    ["S", "save"],
    ["s", "save"],
  ] as const)("maps Ctrl+Shift+%s to %s", (key, action) => {
    expect(invoiceShortcut(press(key))).toBe(action);
  });

  it("ignores plain Ctrl+P and Ctrl+S", () => {
    expect(invoiceShortcut(press("p", { shiftKey: false }))).toBeNull();
    expect(invoiceShortcut(press("s", { shiftKey: false }))).toBeNull();
  });

  it("ignores Shift without Ctrl", () => {
    expect(invoiceShortcut(press("P", { ctrlKey: false }))).toBeNull();
  });

  it("ignores Alt or Meta", () => {
    expect(invoiceShortcut(press("P", { altKey: true }))).toBeNull();
    expect(invoiceShortcut(press("S", { metaKey: true }))).toBeNull();
  });

  it("ignores other keys", () => {
    expect(invoiceShortcut(press("R"))).toBeNull();
  });
});
