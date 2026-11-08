import type { AuditAction, AuditEntry } from "@shared/audit";
import { formatRupees } from "../lib/money";
import { signedRupees } from "../billing/bill-format";

type Details = NonNullable<AuditEntry["details"]>;

const detailsOf = (entry: AuditEntry): Details => entry.details ?? {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const whole = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

const rupees = (value: unknown): string | undefined => {
  const paisa = whole(value);
  return paisa === undefined ? undefined : formatRupees(paisa);
};

const quantity = (value: unknown): string | undefined => {
  const milli = whole(value);
  if (milli === undefined) return undefined;
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const fraction = String(abs % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${sign}${Math.floor(abs / 1000)}${fraction ? `.${fraction}` : ""}`;
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const join = (parts: (string | null | undefined | false)[], separator = ", "): string =>
  parts.filter(Boolean).join(separator);

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const invoice = (value: unknown): string | undefined => {
  const no = text(value);
  return no ? `Invoice ${no}` : undefined;
};

const lines = (value: unknown): string | undefined => {
  const count = whole(value);
  return count === undefined ? undefined : plural(count, "line");
};

const productPrice = (entry: AuditEntry): string => {
  const details = detailsOf(entry);
  const from = rupees(details.oldPaisa) ?? "product price";
  const to = rupees(details.newPaisa) ?? "product price";
  const barcode = text(details.barcode);
  return join([
    `${entry.productName ? `${entry.productName}: ` : ""}${from} → ${to}`,
    barcode && `barcode ${barcode}`,
    details.bulk === true && "bulk edit",
  ]);
};

const drawerReasons: Record<string, string> = {
  cash_in: "Cash in",
  cash_out: "Cash out",
  opening_count: "Opening count",
  closing_count: "Closing count",
  test: "Drawer test",
};

const settingNames: Record<string, string> = {
  scalePrefixes: "Scale prefixes",
  miscItemEnabled: "Misc item",
  shiftVarianceWarnPaisa: "Shift variance warning",
  receipt: "Receipt",
  printer: "Printer",
};

const changeVerbs: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
};

const entityNames: Record<string, string> = {
  category: "Category",
  tax_category: "Tax category",
};

const settingsChange = (entry: AuditEntry): string => {
  const details = detailsOf(entry);
  const setting = text(details.setting);
  if (setting) return settingNames[setting] ?? "";
  const entity = entry.entityType ? entityNames[entry.entityType] : undefined;
  const verb = changeVerbs[text(details.change) ?? ""];
  if (!entity || !verb) return "";
  const renamed = text(record(record(details.changes).name).to);
  const name = text(details.name) ?? renamed;
  return `${entity} ${verb}${name ? `: ${name}` : ""}`;
};

const userUpdate = (entry: AuditEntry): string => {
  const details = detailsOf(entry);
  const reset = text(details.reset);
  if (reset === "password") return "Password reset";
  if (reset === "pin") return "PIN reset";
  const name = record(record(details.changes).displayName);
  const from = text(name.from);
  const to = text(name.to);
  return from && to ? `Name: ${from} → ${to}` : "";
};

const stockAdjustment = (entry: AuditEntry): string => {
  const details = detailsOf(entry);
  const change = quantity(details.qtyMilli);
  const before = quantity(details.onHandBeforeMilli);
  const after = quantity(details.onHandAfterMilli);
  const delta = change === undefined ? undefined : `${change.startsWith("-") ? "" : "+"}${change}`;
  return join([
    join([entry.productName && `${entry.productName}:`, delta], " "),
    before !== undefined && after !== undefined && `on hand ${before} → ${after}`,
    text(details.reason),
  ]);
};

const shiftClose = (entry: AuditEntry): string => {
  const details = detailsOf(entry);
  const counted = rupees(details.countedCashPaisa);
  const variance = whole(details.variancePaisa);
  return join([
    counted && `Counted ${counted}`,
    variance !== undefined && `variance ${variance > 0 ? "+" : ""}${signedRupees(variance)}`,
  ]);
};

const returnSummary = (entry: AuditEntry): string => {
  const details = detailsOf(entry);
  const total = whole(details.returnTotalPaisa);
  const withoutReceipt = whole(details.withoutReceiptLineCount) ?? 0;
  const damaged = whole(details.damagedLineCount) ?? 0;
  const refunded = text(details.refundedInvoiceNo);
  return join([
    invoice(details.invoiceNo),
    refunded && `refund of invoice ${refunded}`,
    total !== undefined && formatRupees(Math.abs(total)),
    withoutReceipt > 0 && `${plural(withoutReceipt, "line")} without receipt`,
    damaged > 0 && `${damaged} damaged`,
  ]);
};

const username = (entry: AuditEntry): string => text(detailsOf(entry).username) ?? "";
const supplierName = (entry: AuditEntry): string => text(detailsOf(entry).name) ?? "";
const productNameEn = (entry: AuditEntry): string => text(detailsOf(entry).nameEn) ?? "";

const orderNo = (entry: AuditEntry): string => text(detailsOf(entry).orderNo) ?? "";

const summarisers: Record<AuditAction, (entry: AuditEntry) => string> = {
  login: (entry) => {
    const method = text(detailsOf(entry).method);
    if (method === "password") return "Signed in with password";
    if (method === "pin") return "Switched user with PIN";
    return "";
  },
  logout: () => "",
  line_delete: (entry) => {
    const details = detailsOf(entry);
    const gross = rupees(details.grossPaisa);
    const qty = quantity(details.qtyMilli);
    return join([gross && `${gross} line`, qty && `qty ${qty}`]);
  },
  bill_discard: (entry) => {
    const details = detailsOf(entry);
    return join([lines(details.lineCount), rupees(details.totalPaisa)]);
  },
  return: returnSummary,
  return_without_receipt: (entry) => {
    const details = detailsOf(entry);
    return join([invoice(details.invoiceNo), lines(details.lineCount)]);
  },
  price_change: productPrice,
  cost_change: productPrice,
  stock_adjustment: stockAdjustment,
  drawer_open_no_sale: (entry) => {
    const details = detailsOf(entry);
    const reason = drawerReasons[text(details.reason) ?? ""];
    if (!reason) return "";
    return details.successful === false ? `${reason}, failed` : reason;
  },
  settings_change: settingsChange,
  backup: () => "",
  restore: () => "",
  user_create: username,
  user_update: userUpdate,
  user_deactivate: username,
  user_reactivate: username,
  product_archive: productNameEn,
  product_restore: productNameEn,
  product_delete: productNameEn,
  supplier_archive: supplierName,
  supplier_restore: supplierName,
  purchase_order_create: (entry) => {
    const details = detailsOf(entry);
    return join([text(details.orderNo), lines(details.lineCount), rupees(details.totalPaisa)]);
  },
  purchase_order_confirm: orderNo,
  purchase_order_cancel: orderNo,
  goods_received_post: (entry) => {
    const details = detailsOf(entry);
    return join([text(details.grnNo), lines(details.lineCount), rupees(details.totalPaisa)]);
  },
  purchase_return_post: (entry) => {
    const details = detailsOf(entry);
    return join([text(details.returnNo), lines(details.lineCount), rupees(details.totalPaisa)]);
  },
  stocktake_post: (entry) => {
    const details = detailsOf(entry);
    const adjustments = whole(details.adjustmentCount);
    return join([
      lines(details.lineCount),
      adjustments !== undefined && plural(adjustments, "adjustment"),
    ]);
  },
  shift_open: (entry) => {
    const float = rupees(detailsOf(entry).openingFloatPaisa);
    return float ? `Float ${float}` : "";
  },
  shift_close: shiftClose,
  cash_move_delete: (entry) => {
    const details = detailsOf(entry);
    const amount = rupees(details.amountPaisa);
    const kind = text(details.kind);
    const label = kind === "in" ? "Cash in" : kind === "out" ? "Cash out" : "Cash move";
    return join([join([label, amount], " "), text(details.reason)], ": ");
  },
  sale_complete: (entry) => {
    const details = detailsOf(entry);
    return join([invoice(details.invoiceNo), lines(details.lineCount), rupees(details.totalPaisa)]);
  },
};

export function summariseAudit(entry: AuditEntry): string {
  return summarisers[entry.action](entry);
}
