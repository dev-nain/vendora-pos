import { describe, expect, it } from "vitest";
import { auditActions, type AuditAction, type AuditEntry } from "@shared/audit";
import { summariseAudit } from "./audit-summary";

const entry = (
  action: AuditAction,
  details: AuditEntry["details"],
  extra: Partial<AuditEntry> = {},
): AuditEntry => ({
  id: "0192f3a0-0000-7000-8000-000000000001",
  createdAt: "2026-01-01T00:00:00.000Z",
  actorName: "Ayesha",
  action,
  entityType: null,
  productName: null,
  details,
  ...extra,
});

describe("summariseAudit", () => {
  it.each([
    [entry("login", { method: "password" }), "Signed in with password"],
    [entry("login", { method: "pin", previousUserId: "x" }), "Switched user with PIN"],
    [entry("logout", null), ""],
    [entry("line_delete", { grossPaisa: 42000, qtyMilli: 2000 }), "Rs 420 line, qty 2"],
    [entry("bill_discard", { lineCount: 3, totalPaisa: 124000 }), "3 lines, Rs 1,240"],
    [
      entry("return", {
        invoiceNo: "T1-5",
        refundedInvoiceNo: "T1-2",
        returnTotalPaisa: -42000,
        withoutReceiptLineCount: 0,
        damagedLineCount: 1,
      }),
      "Invoice T1-5, refund of invoice T1-2, Rs 420, 1 damaged",
    ],
    [
      entry("return", { invoiceNo: "T1-6", returnTotalPaisa: -1000, withoutReceiptLineCount: 2 }),
      "Invoice T1-6, Rs 10, 2 lines without receipt",
    ],
    [entry("return_without_receipt", { invoiceNo: "T1-6", lineCount: 1 }), "Invoice T1-6, 1 line"],
    [
      entry(
        "price_change",
        { oldPaisa: 105000, newPaisa: 110000 },
        { entityType: "product", productName: "Tapal 950g" },
      ),
      "Tapal 950g: Rs 1,050 → Rs 1,100",
    ],
    [
      entry(
        "price_change",
        { barcode: "123", oldPaisa: null, newPaisa: 5000 },
        { productName: "Tapal 950g" },
      ),
      "Tapal 950g: product price → Rs 50, barcode 123",
    ],
    [
      entry(
        "cost_change",
        { oldPaisa: 90000, newPaisa: 95000, bulk: true },
        { productName: "Tapal 950g" },
      ),
      "Tapal 950g: Rs 900 → Rs 950, bulk edit",
    ],
    [
      entry(
        "stock_adjustment",
        { qtyMilli: 5000, onHandBeforeMilli: 12000, onHandAfterMilli: 17000, reason: "recount" },
        { productName: "Tapal 950g" },
      ),
      "Tapal 950g: +5, on hand 12 → 17, recount",
    ],
    [
      entry("stock_adjustment", {
        qtyMilli: -1500,
        onHandBeforeMilli: 3000,
        onHandAfterMilli: 1500,
      }),
      "-1.5, on hand 3 → 1.5",
    ],
    [entry("drawer_open_no_sale", { reason: "cash_in", successful: true }), "Cash in"],
    [entry("drawer_open_no_sale", { reason: "cash_out", successful: true }), "Cash out"],
    [entry("drawer_open_no_sale", { reason: "opening_count", successful: true }), "Opening count"],
    [entry("drawer_open_no_sale", { reason: "closing_count", successful: true }), "Closing count"],
    [entry("drawer_open_no_sale", { reason: "test", successful: true }), "Drawer test"],
    [entry("drawer_open_no_sale", { reason: "cash_in", successful: false }), "Cash in, failed"],
    [
      entry("settings_change", { change: "create", name: "Snacks" }, { entityType: "category" }),
      "Category created: Snacks",
    ],
    [
      entry(
        "settings_change",
        { change: "update", changes: { name: { from: "GST", to: "GST 18" } } },
        { entityType: "tax_category" },
      ),
      "Tax category updated: GST 18",
    ],
    [
      entry("settings_change", { setting: "scalePrefixes" }, { entityType: "store" }),
      "Scale prefixes",
    ],
    [entry("settings_change", { setting: "miscItemEnabled" }), "Misc item"],
    [entry("settings_change", { setting: "shiftVarianceWarnPaisa" }), "Shift variance warning"],
    [entry("settings_change", { setting: "printer" }), "Printer"],
    [entry("user_create", { username: "sara" }), "sara"],
    [entry("user_deactivate", { username: "sara" }), "sara"],
    [entry("user_reactivate", { username: "sara" }), "sara"],
    [entry("user_update", { reset: "password" }), "Password reset"],
    [entry("user_update", { reset: "pin" }), "PIN reset"],
    [
      entry("user_update", { changes: { displayName: { from: "Sara", to: "Sara Khan" } } }),
      "Name: Sara → Sara Khan",
    ],
    [entry("product_archive", { nameEn: "Tapal 950g" }), "Tapal 950g"],
    [entry("supplier_archive", { name: "Karachi Traders" }), "Karachi Traders"],
    [entry("supplier_restore", { name: "Karachi Traders" }), "Karachi Traders"],
    [entry("product_restore", { nameEn: "Tapal 950g" }), "Tapal 950g"],
    [entry("product_delete", { nameEn: "Tapal 950g", barcodes: ["1"] }), "Tapal 950g"],
    [entry("shift_open", { openingFloatPaisa: 500000 }), "Float Rs 5,000"],
    [
      entry("shift_close", { countedCashPaisa: 510000, variancePaisa: 10000 }),
      "Counted Rs 5,100, variance +Rs 100",
    ],
    [
      entry("shift_close", { countedCashPaisa: 490000, variancePaisa: -10000 }),
      "Counted Rs 4,900, variance −Rs 100",
    ],
    [
      entry("cash_move_delete", { kind: "in", amountPaisa: 50000, reason: "float top-up" }),
      "Cash in Rs 500: float top-up",
    ],
    [
      entry("sale_complete", { invoiceNo: "T1-9", lineCount: 3, totalPaisa: 124000 }),
      "Invoice T1-9, 3 lines, Rs 1,240",
    ],
    [entry("backup", null), ""],
    [entry("restore", null), ""],
  ])("summarises %#", (input, expected) => {
    expect(summariseAudit(input)).toBe(expected);
  });

  it("returns a string for every action with no details", () => {
    for (const action of auditActions) {
      expect(typeof summariseAudit(entry(action, null))).toBe("string");
    }
  });

  it("survives wrong-shaped details without printing undefined", () => {
    for (const action of auditActions) {
      for (const details of [
        { grossPaisa: "x", qtyMilli: 1.5, changes: 3, setting: 4, totalPaisa: null },
        { oldPaisa: {}, newPaisa: [], reason: 7, kind: 1, successful: "no" },
      ]) {
        const summary = summariseAudit(entry(action, details));
        expect(summary).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });

  it("shows only the word Receipt for a receipt settings entry", () => {
    const long = "A very long receipt footer ".repeat(20);
    expect(
      summariseAudit(
        entry("settings_change", {
          setting: "receipt",
          from: { footer: long },
          to: { footer: long },
        }),
      ),
    ).toBe("Receipt");
  });
});
