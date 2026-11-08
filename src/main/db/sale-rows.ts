import { uuidv7 } from "./id";
import type {
  PaymentMethod,
  ProductUnit,
  receiptPrints,
  saleLines,
  salePayments,
  sales,
} from "./schema";

type SaleRef = { id: string; storeId: string; terminalId: string };

export type Buyer = {
  name: string | null;
  ntn: string | null;
  cnic: string | null;
  phone: string | null;
};

export function resolveTaxRateBps(
  categoryRateBps: number | null,
  storeStandardRateBps: number,
): number {
  return categoryRateBps ?? storeStandardRateBps;
}

export function saleRow(input: {
  id?: string;
  storeId: string;
  terminalId: string;
  shiftId: string;
  draftId: string;
  invoiceNo: string;
  cashierUserId: string;
  refundedSaleId: string | null;
  pricesIncludeTax: boolean;
  totals: {
    subtotalPaisa: number;
    discountPaisa: number;
    taxPaisa: number;
    roundingPaisa: number;
    totalPaisa: number;
  };
  deletedLineCount: number;
  buyer: Buyer;
}): typeof sales.$inferInsert {
  return {
    id: input.id ?? uuidv7(),
    storeId: input.storeId,
    terminalId: input.terminalId,
    shiftId: input.shiftId,
    draftId: input.draftId,
    invoiceNo: input.invoiceNo,
    type: input.totals.totalPaisa < 0 ? "refund" : "sale",
    refundedSaleId: input.refundedSaleId,
    cashierUserId: input.cashierUserId,
    pricesIncludeTax: input.pricesIncludeTax,
    subtotalPaisa: input.totals.subtotalPaisa,
    discountPaisa: input.totals.discountPaisa,
    taxPaisa: input.totals.taxPaisa,
    roundingPaisa: input.totals.roundingPaisa,
    totalPaisa: input.totals.totalPaisa,
    deletedLineCount: input.deletedLineCount,
    buyerName: input.buyer.name,
    buyerNtn: input.buyer.ntn,
    buyerCnic: input.buyer.cnic,
    buyerPhone: input.buyer.phone,
  };
}

export function saleLineRow(input: {
  sale: SaleRef & { refundedSaleId: string | null };
  position: number;
  product: {
    id: string;
    nameEn: string;
    nameUr: string | null;
    unit: ProductUnit;
    costPaisa: number;
    mrpPaisa: number | null;
    pctCode: string | null;
    isThirdSchedule: boolean;
    categoryId: string | null;
    categoryName: string | null;
  };
  taxRateBps: number;
  line: {
    qtyMilli: number;
    isReturn: boolean;
    refundedLineId: string | null;
    unitPricePaisa: number;
    packQtyMilli: number;
    barcode: string | null;
    miscName: string | null;
  };
  amounts: {
    grossPaisa: number;
    lineDiscountPaisa: number;
    billDiscountPaisa: number;
    taxPaisa: number;
    totalPaisa: number;
  };
}): typeof saleLines.$inferInsert {
  const { sale, product, line, amounts } = input;
  return {
    storeId: sale.storeId,
    terminalId: sale.terminalId,
    saleId: sale.id,
    position: input.position,
    productId: product.id,
    nameEn: line.miscName ?? product.nameEn,
    nameUr: product.nameUr,
    unit: product.unit,
    qtyMilli: line.qtyMilli,
    isReturn: line.isReturn,
    unitPricePaisa: line.unitPricePaisa,
    mrpPaisa: product.mrpPaisa,
    costPaisa: product.costPaisa,
    taxRateBps: input.taxRateBps,
    isThirdSchedule: product.isThirdSchedule,
    pctCode: product.pctCode,
    grossPaisa: amounts.grossPaisa,
    lineDiscountPaisa: amounts.lineDiscountPaisa,
    billDiscountPaisa: amounts.billDiscountPaisa,
    discountPaisa: amounts.lineDiscountPaisa + amounts.billDiscountPaisa,
    taxPaisa: amounts.taxPaisa,
    totalPaisa: amounts.totalPaisa,
    refundedSaleId: line.refundedLineId ? sale.refundedSaleId : null,
    refundedLineId: line.refundedLineId,
    barcode: line.barcode,
    packQtyMilli: line.packQtyMilli,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
  };
}

export function paymentRow(input: {
  sale: SaleRef;
  position: number;
  method: PaymentMethod;
  amountPaisa: number;
  reference: string | null;
  cashierUserId: string;
}): typeof salePayments.$inferInsert {
  return {
    storeId: input.sale.storeId,
    terminalId: input.sale.terminalId,
    saleId: input.sale.id,
    position: input.position,
    method: input.method,
    amountPaisa: input.amountPaisa,
    reference: input.method === "cash" ? null : input.reference,
    isChange: false,
    reversesPaymentId: null,
    cashierUserId: input.cashierUserId,
  };
}

export function changeRow(input: {
  sale: SaleRef;
  position: number;
  changePaisa: number;
  cashierUserId: string;
}): typeof salePayments.$inferInsert {
  if (input.changePaisa <= 0) throw new Error("Change must be positive");
  return {
    ...paymentRow({
      sale: input.sale,
      position: input.position,
      method: "cash",
      amountPaisa: -input.changePaisa,
      reference: null,
      cashierUserId: input.cashierUserId,
    }),
    isChange: true,
  };
}

export function reversalRow(input: {
  original: {
    id: string;
    saleId: string;
    storeId: string;
    terminalId: string;
    method: PaymentMethod;
    amountPaisa: number;
    reference: string | null;
  };
  position: number;
  cashierUserId: string;
}): typeof salePayments.$inferInsert {
  const { original } = input;
  return {
    ...paymentRow({
      sale: { id: original.saleId, storeId: original.storeId, terminalId: original.terminalId },
      position: input.position,
      method: original.method,
      amountPaisa: -original.amountPaisa,
      reference: original.reference,
      cashierUserId: input.cashierUserId,
    }),
    reversesPaymentId: original.id,
  };
}

export function receiptPrintRow(input: {
  sale: SaleRef;
  printedBy: string;
}): typeof receiptPrints.$inferInsert {
  return {
    storeId: input.sale.storeId,
    terminalId: input.sale.terminalId,
    saleId: input.sale.id,
    printedBy: input.printedBy,
  };
}
