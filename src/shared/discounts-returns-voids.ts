import { z } from "zod";
import { productUnits } from "./products";
import type { ReportColumn } from "./reports";

export const reportDetailLimit = 200;

const count = z.number().int();
const iso = z.iso.datetime();

export const returnSummaryKinds = [
  "with-receipt",
  "without-receipt",
  "back-to-shelf",
  "damaged",
] as const;
export type ReturnSummaryKind = (typeof returnSummaryKinds)[number];

export const returnDispositions = ["back-to-shelf", "damaged", "no-stock"] as const;
export type ReturnDisposition = (typeof returnDispositions)[number];

export const voidBillStates = ["sold", "discarded", "not-completed"] as const;
export type VoidBillState = (typeof voidBillStates)[number];

const discountByUserSchema = z.strictObject({
  userId: z.string(),
  userName: z.string(),
  billCount: count,
  discountPaisa: count,
});

const discountBillSchema = z.strictObject({
  saleId: z.string(),
  invoiceNo: z.string(),
  createdAt: iso,
  userName: z.string(),
  totalPaisa: count,
  discountPaisa: count,
});

const returnSummarySchema = z.strictObject({
  kind: z.enum(returnSummaryKinds),
  label: z.string(),
  lineCount: count,
  valuePaisa: count,
});

const returnLineSchema = z.strictObject({
  lineId: z.string(),
  saleId: z.string(),
  invoiceNo: z.string(),
  createdAt: iso,
  userName: z.string(),
  itemName: z.string(),
  unit: z.enum(productUnits),
  qtyMilli: count,
  receiptInvoiceNo: z.string().nullable(),
  disposition: z.enum(returnDispositions),
  valuePaisa: count,
});

const deletedLineSchema = z.strictObject({
  auditId: z.string(),
  createdAt: iso,
  userName: z.string(),
  itemName: z.string(),
  unit: z.enum(productUnits),
  qtyMilli: count,
  billState: z.enum(voidBillStates),
  invoiceNo: z.string().nullable(),
  grossPaisa: count,
});

const discardedBillSchema = z.strictObject({
  auditId: z.string(),
  createdAt: iso,
  userName: z.string(),
  lineCount: count,
  totalPaisa: count,
});

export const discountsReturnsVoidsResultSchema = z.strictObject({
  discounts: z.strictObject({
    byUser: z.array(discountByUserSchema),
    bills: z.array(discountBillSchema),
    billCount: count,
    discountPaisa: count,
  }),
  returns: z.strictObject({
    summary: z.array(returnSummarySchema),
    lines: z.array(returnLineSchema),
    lineCount: count,
    valuePaisa: count,
  }),
  voids: z.strictObject({
    deletedLines: z.strictObject({
      rows: z.array(deletedLineSchema),
      count,
      grossPaisa: count,
    }),
    discardedBills: z.strictObject({
      rows: z.array(discardedBillSchema),
      count,
      totalPaisa: count,
    }),
  }),
});
export type DiscountsReturnsVoidsResult = z.infer<typeof discountsReturnsVoidsResultSchema>;
export type DiscountBillRow = DiscountsReturnsVoidsResult["discounts"]["bills"][number];
export type DiscountByUserRow = DiscountsReturnsVoidsResult["discounts"]["byUser"][number];
export type ReturnSummaryRow = DiscountsReturnsVoidsResult["returns"]["summary"][number];
export type ReturnLineRow = DiscountsReturnsVoidsResult["returns"]["lines"][number];
export type DeletedLineRow = DiscountsReturnsVoidsResult["voids"]["deletedLines"]["rows"][number];
export type DiscardedBillRow =
  DiscountsReturnsVoidsResult["voids"]["discardedBills"]["rows"][number];

export type SectionRow = Record<string, string | number>;

export type SectionId =
  | "discounts-by-user"
  | "discounted-bills"
  | "returns-summary"
  | "returned-lines"
  | "deleted-lines"
  | "discarded-bills";

export interface ReportSection {
  id: SectionId;
  title: string;
  rowKey: string;
  columns: ReportColumn<SectionRow>[];
  rows: SectionRow[];
  totals: Record<string, number> | null;
  shown: number;
  total: number;
}

export const withoutReceiptLabel = "Without receipt";

const dispositionLabels: Record<ReturnDisposition, string> = {
  "back-to-shelf": "Back to shelf",
  damaged: "Damaged",
  "no-stock": "No stock",
};

const billStateLabels: Record<Exclude<VoidBillState, "sold">, string> = {
  discarded: "Discarded",
  "not-completed": "Not completed",
};

export const sectionNote = ({ shown, total }: Pick<ReportSection, "shown" | "total">) =>
  shown < total ? `Showing the latest ${shown} of ${total}. The CSV export has every row.` : null;

export function discountsReturnsVoidsSections({
  discounts,
  returns,
  voids,
}: DiscountsReturnsVoidsResult): ReportSection[] {
  return [
    {
      id: "discounts-by-user",
      title: "Discounts by user",
      rowKey: "userId",
      columns: [
        { key: "userName", label: "User", format: "text", width: "240px" },
        { key: "billCount", label: "Bills", format: "count", width: "80px" },
        { key: "discountPaisa", label: "Discount", format: "money", width: "120px" },
      ],
      rows: discounts.byUser,
      totals: { billCount: discounts.billCount, discountPaisa: discounts.discountPaisa },
      shown: discounts.byUser.length,
      total: discounts.byUser.length,
    },
    {
      id: "discounted-bills",
      title: "Discounted bills",
      rowKey: "saleId",
      columns: [
        { key: "invoiceNo", label: "Invoice", format: "invoice", width: "110px" },
        { key: "createdAt", label: "Time", format: "time", width: "150px" },
        { key: "userName", label: "User", format: "text", width: "130px" },
        { key: "totalPaisa", label: "Bill total", format: "money", width: "120px" },
        { key: "discountPaisa", label: "Discount", format: "money", width: "110px" },
      ],
      rows: discounts.bills,
      totals: null,
      shown: discounts.bills.length,
      total: discounts.billCount,
    },
    {
      id: "returns-summary",
      title: "Returns summary",
      rowKey: "kind",
      columns: [
        { key: "label", label: "Return", format: "text", width: "200px" },
        { key: "lineCount", label: "Lines", format: "count", width: "80px" },
        { key: "valuePaisa", label: "Value", format: "money", width: "120px" },
      ],
      rows: returns.summary,
      totals: null,
      shown: returns.summary.length,
      total: returns.summary.length,
    },
    {
      id: "returned-lines",
      title: "Returned lines",
      rowKey: "lineId",
      columns: [
        { key: "invoiceNo", label: "Invoice", format: "invoice", width: "100px" },
        { key: "createdAt", label: "Time", format: "time", width: "140px" },
        { key: "userName", label: "User", format: "text", width: "100px" },
        { key: "itemName", label: "Item", format: "text", width: "150px" },
        { key: "qtyMilli", label: "Qty", format: "quantity", unitKey: "unit", width: "80px" },
        { key: "receipt", label: "Receipt", format: "text", width: "120px" },
        { key: "stock", label: "Stock", format: "text", width: "100px" },
        { key: "valuePaisa", label: "Value", format: "money", width: "100px" },
      ],
      rows: returns.lines.map(({ receiptInvoiceNo, disposition, ...line }) => ({
        ...line,
        receipt: receiptInvoiceNo ?? withoutReceiptLabel,
        stock: dispositionLabels[disposition],
      })),
      totals: null,
      shown: returns.lines.length,
      total: returns.lineCount,
    },
    {
      id: "deleted-lines",
      title: "Deleted lines",
      rowKey: "auditId",
      columns: [
        { key: "createdAt", label: "Time", format: "time", width: "150px" },
        { key: "userName", label: "User", format: "text", width: "110px" },
        { key: "itemName", label: "Item", format: "text", width: "170px" },
        { key: "qtyMilli", label: "Qty", format: "quantity", unitKey: "unit", width: "80px" },
        { key: "bill", label: "Bill", format: "invoice", linkKey: "invoiceNo", width: "110px" },
        { key: "grossPaisa", label: "Gross before discount", format: "money", width: "130px" },
      ],
      rows: voids.deletedLines.rows.map(({ billState, invoiceNo, ...line }) => ({
        ...line,
        bill: billState === "sold" ? (invoiceNo ?? "") : billStateLabels[billState],
        invoiceNo: invoiceNo ?? "",
      })),
      totals: { grossPaisa: voids.deletedLines.grossPaisa },
      shown: voids.deletedLines.rows.length,
      total: voids.deletedLines.count,
    },
    {
      id: "discarded-bills",
      title: "Discarded bills",
      rowKey: "auditId",
      columns: [
        { key: "createdAt", label: "Time", format: "time", width: "170px" },
        { key: "userName", label: "User", format: "text", width: "140px" },
        { key: "lineCount", label: "Lines", format: "count", width: "80px" },
        { key: "totalPaisa", label: "Bill total", format: "money", width: "120px" },
      ],
      rows: voids.discardedBills.rows,
      totals: { totalPaisa: voids.discardedBills.totalPaisa },
      shown: voids.discardedBills.rows.length,
      total: voids.discardedBills.count,
    },
  ];
}
