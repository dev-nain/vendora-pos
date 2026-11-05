import { paymentMethodLabels } from "../../shared/checkout";
import { formatQuantity } from "../../shared/quantity";
import { formatRupees } from "../../shared/money";
import type {
  ReceiptBlock,
  ReceiptMetrics,
  ReceiptModel,
  ReceiptWidthPx,
} from "../../shared/receipt";
import type { ReceiptSettings } from "../../shared/settings";
import { code128Modules } from "../hardware/code128";
import type { SaleSnapshot, SnapshotLine } from "./sale-snapshot";

const MINUS = "−";

export function metricsFor(widthPx: ReceiptWidthPx): ReceiptMetrics {
  return widthPx === 576
    ? { bodyPx: 24, titlePx: 36, urduLineHeight: 1.9, latinLineHeight: 1.3 }
    : { bodyPx: 20, titlePx: 28, urduLineHeight: 1.9, latinLineHeight: 1.3 };
}

export const signedRupees = (paisa: number): string =>
  paisa < 0 ? `${MINUS}${formatRupees(-paisa)}` : formatRupees(paisa);

export const negativeRupees = (paisa: number): string => `${MINUS}${formatRupees(paisa)}`;

const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatReceiptTime(date: Date): string {
  const hour = date.getHours() % 12 || 12;
  return `${hour}:${pad2(date.getMinutes())} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

export function formatReceiptDateTime(date: Date): string {
  const day = `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
  return `${day} ${formatReceiptTime(date)}`;
}

export function rateText(rateBps: number): string {
  const whole = Math.floor(rateBps / 100);
  const fraction = String(rateBps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${fraction ? `${whole}.${fraction}` : whole}%`;
}

export const text = (
  value: string,
  options: Partial<Omit<Extract<ReceiptBlock, { type: "text" }>, "type" | "text">> = {},
): ReceiptBlock => ({
  type: "text",
  text: value,
  lang: "en",
  align: "left",
  size: "body",
  weight: "normal",
  ...options,
});

export const pair = (
  left: string,
  right: string,
  options: { weight?: "normal" | "bold"; size?: "body" | "title" } = {},
): ReceiptBlock => ({
  type: "pair",
  left,
  right,
  weight: options.weight ?? "normal",
  size: options.size ?? "body",
});

const rule: ReceiptBlock = { type: "rule" };
const gap = (heightPx: number): ReceiptBlock => ({ type: "gap", heightPx });

function linesOf(value: string | null): string[] {
  return value ? value.split(/\r?\n/).filter((line) => line.trim() !== "") : [];
}

export function headerBlocks(store: ReceiptSettings): ReceiptBlock[] {
  const centered = (value: string, lang: "en" | "ur" = "en") =>
    text(value, { align: "center", lang });
  const blocks: ReceiptBlock[] = [];
  if (store.name) blocks.push(text(store.name, { align: "center", size: "title", weight: "bold" }));
  if (store.address) blocks.push(centered(store.address));
  if (store.phone) blocks.push(centered(store.phone));
  if (store.ntn) blocks.push(centered(`NTN ${store.ntn}`));
  if (store.strn) blocks.push(centered(`STRN ${store.strn}`));
  for (const line of linesOf(store.headerEn)) blocks.push(centered(line));
  for (const line of linesOf(store.headerUr)) blocks.push(centered(line, "ur"));
  return blocks;
}

export function footerBlocks(store: ReceiptSettings): ReceiptBlock[] {
  return [
    ...linesOf(store.footerEn).map((line) => text(line, { align: "center" })),
    ...linesOf(store.footerUr).map((line) => text(line, { align: "center", lang: "ur" })),
  ];
}

export function barcodeBlock(value: string, widthPx: ReceiptWidthPx): ReceiptBlock {
  const modules = code128Modules(value);
  return {
    type: "barcode",
    modules,
    moduleWidthPx: modules.length * 2 <= widthPx ? 2 : 1,
    heightPx: widthPx === 576 ? 64 : 56,
    caption: value,
  };
}

function quantityText(line: SnapshotLine): string {
  const price = formatRupees(line.unitPricePaisa);
  const isPack = line.packQtyMilli !== 1000;
  const isWeighed = line.unit !== "piece" && !isPack;
  const qty = isWeighed ? formatQuantity(line.qtyMilli, line.unit) : String(line.qtyMilli / 1000);
  const base = isPack
    ? `${qty} × Pack (${formatQuantity(line.packQtyMilli, line.unit)}) at ${price}`
    : `${qty} × ${price}`;
  return `${line.isReturn ? "Return · " : ""}${base} · ${rateText(line.taxRateBps)}`;
}

function lineBlocks(line: SnapshotLine): ReceiptBlock[] {
  const blocks: ReceiptBlock[] = [text(line.nameEn, { weight: "bold" })];
  if (line.nameUr) blocks.push(text(line.nameUr, { lang: "ur", align: "right" }));
  blocks.push(pair(quantityText(line), signedRupees(line.grossPaisa)));
  if (line.discountPaisa !== 0) blocks.push(pair("Discount", negativeRupees(line.discountPaisa)));
  return blocks;
}

function taxRows(lines: SnapshotLine[]): string[][] {
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const line of lines) {
    const entry = byRate.get(line.taxRateBps) ?? { taxable: 0, tax: 0 };
    entry.taxable += line.totalPaisa - line.taxPaisa;
    entry.tax += line.taxPaisa;
    byRate.set(line.taxRateBps, entry);
  }
  return [...byRate.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([rate, { taxable, tax }]) => [rateText(rate), signedRupees(taxable), signedRupees(tax)]);
}

export function buildReceiptModel(snapshot: SaleSnapshot, widthPx: ReceiptWidthPx): ReceiptModel {
  const { sale, lines } = snapshot;
  const lineDiscountPaisa = lines.reduce((sum, line) => sum + line.lineDiscountPaisa, 0);
  const billDiscountPaisa = lines.reduce((sum, line) => sum + line.billDiscountPaisa, 0);

  const blocks: ReceiptBlock[] = [...headerBlocks(snapshot.store), gap(8), rule];
  blocks.push(pair("Invoice", sale.invoiceNo, { weight: "bold" }));
  blocks.push(pair("Date", formatReceiptDateTime(sale.createdAt)));
  blocks.push(pair("Cashier", snapshot.cashierName));
  if (sale.buyerName) blocks.push(pair("Buyer", sale.buyerName));
  if (sale.buyerNtn) blocks.push(pair("Buyer NTN", sale.buyerNtn));
  blocks.push(rule);

  for (const line of lines) blocks.push(...lineBlocks(line));
  blocks.push(rule);

  blocks.push(pair("Subtotal", signedRupees(sale.subtotalPaisa)));
  if (lineDiscountPaisa > 0) blocks.push(pair("Discount", negativeRupees(lineDiscountPaisa)));
  if (billDiscountPaisa > 0) blocks.push(pair("Bill discount", negativeRupees(billDiscountPaisa)));
  blocks.push(pair("Sales tax", signedRupees(sale.taxPaisa)));
  if (sale.roundingPaisa !== 0) blocks.push(pair("Rounding", signedRupees(sale.roundingPaisa)));
  blocks.push(pair("Total", signedRupees(sale.totalPaisa), { weight: "bold", size: "title" }));
  blocks.push(rule);

  blocks.push({
    type: "table",
    header: ["Rate", "Taxable", "Tax"],
    rows: taxRows(lines),
  });
  blocks.push(rule);

  for (const payment of snapshot.payments) {
    if (payment.isChange) {
      blocks.push(pair("Change", formatRupees(-payment.amountPaisa)));
      continue;
    }
    const label = paymentMethodLabels[payment.method];
    blocks.push(
      pair(
        payment.reference ? `${label} ${payment.reference}` : label,
        signedRupees(payment.amountPaisa),
      ),
    );
  }
  blocks.push(gap(8), barcodeBlock(sale.invoiceNo, widthPx));

  const footer = footerBlocks(snapshot.store);
  if (footer.length > 0) blocks.push(gap(8), ...footer);

  return { widthPx, metrics: metricsFor(widthPx), blocks };
}
