import { and, asc, eq } from "drizzle-orm";
import type { PaymentMethod } from "../../shared/checkout";
import type { ProductUnit } from "../../shared/products";
import type { PaperWidthMm, ReceiptSettings } from "../../shared/settings";
import { salePayments, saleLines, sales, terminals, users, type SaleType } from "../db/schema";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import { getReceiptSettings } from "../settings/store-settings";

export interface SnapshotLine {
  nameEn: string;
  nameUr: string | null;
  unit: ProductUnit;
  qtyMilli: number;
  packQtyMilli: number;
  isReturn: boolean;
  unitPricePaisa: number;
  taxRateBps: number;
  grossPaisa: number;
  lineDiscountPaisa: number;
  billDiscountPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

export interface SnapshotPayment {
  method: PaymentMethod;
  amountPaisa: number;
  reference: string | null;
  isChange: boolean;
}

export interface SaleSnapshot {
  sale: {
    id: string;
    invoiceNo: string;
    type: SaleType;
    createdAt: Date;
    subtotalPaisa: number;
    discountPaisa: number;
    taxPaisa: number;
    roundingPaisa: number;
    totalPaisa: number;
    buyerName: string | null;
    buyerNtn: string | null;
  };
  cashierName: string;
  lines: SnapshotLine[];
  payments: SnapshotPayment[];
  store: ReceiptSettings;
  paperWidthMm: PaperWidthMm;
}

export function loadSaleSnapshot(executor: DbExecutor, saleId: string): SaleSnapshot | null {
  const terminal = currentTerminal(executor);
  const found = executor
    .select({
      sale: sales,
      cashierName: users.displayName,
      paperWidthMm: terminals.paperWidthMm,
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.cashierUserId))
    .innerJoin(terminals, eq(terminals.id, sales.terminalId))
    .where(
      and(
        eq(sales.id, saleId),
        eq(sales.terminalId, terminal.id),
        eq(sales.storeId, terminal.storeId),
      ),
    )
    .get();
  if (!found) return null;

  const lines = executor
    .select({
      nameEn: saleLines.nameEn,
      nameUr: saleLines.nameUr,
      unit: saleLines.unit,
      qtyMilli: saleLines.qtyMilli,
      packQtyMilli: saleLines.packQtyMilli,
      isReturn: saleLines.isReturn,
      unitPricePaisa: saleLines.unitPricePaisa,
      taxRateBps: saleLines.taxRateBps,
      grossPaisa: saleLines.grossPaisa,
      lineDiscountPaisa: saleLines.lineDiscountPaisa,
      billDiscountPaisa: saleLines.billDiscountPaisa,
      discountPaisa: saleLines.discountPaisa,
      taxPaisa: saleLines.taxPaisa,
      totalPaisa: saleLines.totalPaisa,
    })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(saleLines.position))
    .all();
  const payments = executor
    .select({
      method: salePayments.method,
      amountPaisa: salePayments.amountPaisa,
      reference: salePayments.reference,
      isChange: salePayments.isChange,
    })
    .from(salePayments)
    .where(eq(salePayments.saleId, saleId))
    .orderBy(asc(salePayments.position))
    .all();

  const { sale } = found;
  return {
    sale: {
      id: sale.id,
      invoiceNo: sale.invoiceNo,
      type: sale.type,
      createdAt: sale.createdAt,
      subtotalPaisa: sale.subtotalPaisa,
      discountPaisa: sale.discountPaisa,
      taxPaisa: sale.taxPaisa,
      roundingPaisa: sale.roundingPaisa,
      totalPaisa: sale.totalPaisa,
      buyerName: sale.buyerName,
      buyerNtn: sale.buyerNtn,
    },
    cashierName: found.cashierName,
    lines,
    payments,
    store: getReceiptSettings(executor, terminal.storeId),
    paperWidthMm: found.paperWidthMm,
  };
}
