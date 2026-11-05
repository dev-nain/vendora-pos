import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  checkoutMessages,
  type ActionResult,
  type AddMiscInput,
  type AddProductInput,
  type Bill,
  type BillLine,
  type BillResult,
  type CurrentBill,
  type Discount,
  type HoldInput,
  type ScanInput,
  type SetBillDiscountInput,
  type SetDamagedInput,
  type UpdateLineInput,
} from "../../shared/checkout";
import { returnMessages } from "../../shared/returns";
import type { HeldBillSummary } from "../../shared/shifts";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import {
  linkedAmounts,
  leftQtyMilli,
  loadLinkedOriginals,
  loadRefundMethods,
} from "../checkout/linked-lines";
import { computeBill, type FixedAmounts, type TotalsLine } from "../checkout/totals";
import { divRoundHalfUp } from "../../shared/rounding";
import type { VendoraDatabase } from "../db/client";
import { billDraftLines, billDrafts, products, taxCategories, users } from "../db/schema";
import { resolveTaxRateBps } from "../db/sale-rows";
import { currentTerminal, type DbExecutor } from "../db/terminal";
import { scaleLabelPricePaisa } from "../hardware/scale-barcode";
import { getCheckoutSettings } from "../settings/store-settings";
import type { createAuditService } from "./audit";
import { lookupBarcode } from "./barcode-lookup";
import { getMiscItem } from "./products";
import { NoOpenShiftError, requireOpenShift } from "./shifts";

type Session = ReturnType<typeof requireSession>;
type DraftRow = typeof billDrafts.$inferSelect;
type LineRow = typeof billDraftLines.$inferSelect;

interface BillDraftsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  now?: () => Date;
}

export interface Context {
  tx: DbExecutor;
  session: Session;
  terminal: { id: string; storeId: string; code: string };
  shiftId: string;
}

const refuse = <Reason extends string>(reason: Reason, message: string) =>
  ({ ok: false, reason, message }) as const;

const noOpenShift = refuse("no-open-shift", checkoutMessages.noOpenShift);
const notFound = refuse("not-found", checkoutMessages.notFound);
const productNotFound = refuse("product-not-found", checkoutMessages.productNotFound);
const wholeUnits = refuse("whole-units", checkoutMessages.wholeUnits);
const scaleLine = refuse("scale-line", checkoutMessages.scaleLine);
const returnDiscount = refuse("return-discount", checkoutMessages.returnDiscount);
const noPrice = refuse("no-price", checkoutMessages.noPrice);
const miscDisabled = refuse("misc-disabled", checkoutMessages.miscDisabled);
const emptyBill = refuse("empty-bill", checkoutMessages.emptyBill);
const linkedReturn = refuse("linked-return", returnMessages.linkedLocked);
const notReturn = refuse("not-return", returnMessages.notReturn);
const noStock = refuse("no-stock", returnMessages.noStock);

const WHOLE_UNIT_MILLI = 1000;

export function totalsLineOf(
  line: LineRow,
  taxRateBps: number,
  fixedAmounts: FixedAmounts | null = null,
): TotalsLine {
  return {
    id: line.id,
    position: line.position,
    isReturn: line.isReturn,
    qtyMilli: line.qtyMilli,
    unitPricePaisa: line.unitPricePaisa,
    fixedGrossPaisa:
      line.scaleSource === "price" && line.barcode ? scaleLabelPricePaisa(line.barcode) : null,
    discount: toDiscount(line.lineDiscountKind, line.lineDiscountValue),
    fixedAmounts,
    taxRateBps,
  };
}

export function toDiscount(
  kind: "amount" | "percent" | null,
  value: number | null,
): Discount | null {
  if (kind === null || value === null) return null;
  return kind === "amount" ? { kind, amountPaisa: value } : { kind, bps: value };
}

function discountColumns(discount: Discount | null) {
  if (!discount) return { kind: null, value: null };
  return discount.kind === "amount"
    ? { kind: discount.kind, value: discount.amountPaisa }
    : { kind: discount.kind, value: discount.bps };
}

function liveLineCount(tx: DbExecutor, draftId: string): number {
  return (
    tx
      .select({ n: sql<number>`count(*)` })
      .from(billDraftLines)
      .where(and(eq(billDraftLines.draftId, draftId), isNull(billDraftLines.deletedAt)))
      .get()?.n ?? 0
  );
}

function toBill(tx: DbExecutor, draft: DraftRow): Bill {
  const settings = getCheckoutSettings(tx, draft.storeId);
  const rows = tx
    .select({
      line: billDraftLines,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      unit: products.unit,
      categoryRateBps: taxCategories.rateBps,
    })
    .from(billDraftLines)
    .innerJoin(products, eq(products.id, billDraftLines.productId))
    .innerJoin(taxCategories, eq(taxCategories.id, products.taxCategoryId))
    .where(and(eq(billDraftLines.draftId, draft.id), isNull(billDraftLines.deletedAt)))
    .orderBy(asc(billDraftLines.position))
    .all();

  const rateOf = (rate: number | null) => resolveTaxRateBps(rate, settings.standardTaxRateBps);
  const linked = loadLinkedOriginals(
    tx,
    rows.flatMap(({ line }) => (line.refundedLineId ? [line.refundedLineId] : [])),
  );
  const linkedOf = (line: LineRow) =>
    line.refundedLineId ? linked.get(line.refundedLineId) : undefined;
  const lineRateOf = (line: LineRow, categoryRateBps: number | null) =>
    linkedOf(line)?.line.taxRateBps ?? rateOf(categoryRateBps);
  const rounding =
    settings.rounding.mode === "every-bill"
      ? settings.rounding
      : { ...settings.rounding, mode: "off" as const };
  const computed = computeBill({
    lines: rows.map(({ line, categoryRateBps }) => {
      const original = linkedOf(line);
      return totalsLineOf(
        line,
        lineRateOf(line, categoryRateBps),
        original ? linkedAmounts(original, -line.qtyMilli) : null,
      );
    }),
    billDiscount: toDiscount(draft.billDiscountKind, draft.billDiscountValue),
    pricesIncludeTax: settings.pricesIncludeTax,
    rounding,
  });

  const lines = rows.map<BillLine>(({ line, nameEn, nameUr, unit, categoryRateBps }, index) => {
    const amounts = computed.lines[index];
    if (!amounts) throw new Error("Totals are out of step with the lines");
    return {
      id: line.id,
      position: line.position,
      productId: line.productId,
      name: line.miscName ?? nameEn,
      nameUr,
      unit,
      qtyMilli: line.qtyMilli,
      packQtyMilli: line.packQtyMilli,
      unitPricePaisa: line.unitPricePaisa,
      priceType: line.priceType,
      discount: toDiscount(line.lineDiscountKind, line.lineDiscountValue),
      isReturn: line.isReturn,
      isDamaged: line.isDamaged,
      refundedLineId: line.refundedLineId,
      scaleSource: line.scaleSource,
      isMisc: line.miscName !== null,
      grossPaisa: amounts.grossPaisa,
      lineDiscountPaisa: amounts.lineDiscountPaisa,
      billDiscountPaisa: amounts.billDiscountPaisa,
      taxRateBps: lineRateOf(line, categoryRateBps),
      taxPaisa: amounts.taxPaisa,
      totalPaisa: amounts.totalPaisa,
    };
  });

  const deletedLineCount =
    tx
      .select({ n: sql<number>`count(*)` })
      .from(billDraftLines)
      .where(and(eq(billDraftLines.draftId, draft.id), isNotNull(billDraftLines.deletedAt)))
      .get()?.n ?? 0;

  const [firstLinked] = linked.values();
  const refund = firstLinked
    ? {
        saleId: firstLinked.saleId,
        invoiceNo: firstLinked.invoiceNo,
        linkedRefundPaisa: -lines
          .filter((line) => line.refundedLineId !== null)
          .reduce((acc, line) => acc + line.totalPaisa, 0),
        methods: loadRefundMethods(tx, firstLinked.saleId),
      }
    : null;

  return {
    id: draft.id,
    heldAt: draft.heldAt ? draft.heldAt.toISOString() : null,
    billDiscount: toDiscount(draft.billDiscountKind, draft.billDiscountValue),
    lines,
    deletedLineCount,
    refund,
    totals: computed.totals,
    pricesIncludeTax: settings.pricesIncludeTax,
    cashRounding: settings.rounding,
  };
}

function summaryOf(tx: DbExecutor, draft: DraftRow, lineCount: number): HeldBillSummary {
  const cashier =
    tx.select({ name: users.displayName }).from(users).where(eq(users.id, draft.createdBy)).get()
      ?.name ?? "";
  const itemNames = tx
    .select({ name: sql<string>`coalesce(${billDraftLines.miscName}, ${products.nameEn})` })
    .from(billDraftLines)
    .innerJoin(products, eq(products.id, billDraftLines.productId))
    .where(and(eq(billDraftLines.draftId, draft.id), isNull(billDraftLines.deletedAt)))
    .orderBy(asc(billDraftLines.position))
    .limit(3)
    .all()
    .map((row) => row.name);
  return {
    id: draft.id,
    heldAt: (draft.heldAt ?? draft.updatedAt).toISOString(),
    cashier,
    lineCount,
    itemNames,
    totalPaisa: toBill(tx, draft).totals.totalPaisa,
  };
}

function nonEmptyDrafts(tx: DbExecutor, shiftId: string, heldOnly: boolean) {
  const lineCount = sql<number>`(select count(*) from bill_draft_lines where draft_id = bill_drafts.id and deleted_at is null)`;
  return tx
    .select({ draft: billDrafts, lineCount })
    .from(billDrafts)
    .where(
      and(
        eq(billDrafts.shiftId, shiftId),
        eq(billDrafts.state, "draft"),
        heldOnly ? isNotNull(billDrafts.heldAt) : undefined,
        sql`${lineCount} > 0`,
      ),
    )
    .orderBy(asc(sql`coalesce(${billDrafts.heldAt}, ${billDrafts.updatedAt})`), asc(billDrafts.id))
    .all();
}

interface NewLine {
  productId: string;
  unit: "piece" | "kg" | "litre";
  qtyMilli: number;
  isReturn: boolean;
  unitPricePaisa: number;
  priceType: "original" | "manual";
  packQtyMilli: number;
  barcode: string | null;
  scaleSource: "weight" | "price" | null;
  miscName: string | null;
}

export function currentDraft({ tx, terminal, shiftId }: Context): DraftRow | undefined {
  return tx
    .select()
    .from(billDrafts)
    .where(
      and(
        eq(billDrafts.terminalId, terminal.id),
        eq(billDrafts.shiftId, shiftId),
        eq(billDrafts.state, "draft"),
        isNull(billDrafts.heldAt),
      ),
    )
    .orderBy(asc(billDrafts.createdAt), asc(billDrafts.id))
    .get();
}
function findDraft({ tx, terminal, shiftId }: Context, draftId: string): DraftRow | undefined {
  return tx
    .select()
    .from(billDrafts)
    .where(
      and(
        eq(billDrafts.id, draftId),
        eq(billDrafts.storeId, terminal.storeId),
        eq(billDrafts.terminalId, terminal.id),
        eq(billDrafts.shiftId, shiftId),
        eq(billDrafts.state, "draft"),
      ),
    )
    .get();
}
function findLine(
  { tx, terminal, shiftId }: Context,
  lineId: string,
): { line: LineRow; draft: DraftRow; unit: NewLine["unit"]; isSystem: boolean } | undefined {
  return tx
    .select({
      line: billDraftLines,
      draft: billDrafts,
      unit: products.unit,
      isSystem: products.isSystem,
    })
    .from(billDraftLines)
    .innerJoin(billDrafts, eq(billDrafts.id, billDraftLines.draftId))
    .innerJoin(products, eq(products.id, billDraftLines.productId))
    .where(
      and(
        eq(billDraftLines.id, lineId),
        isNull(billDraftLines.deletedAt),
        eq(billDrafts.storeId, terminal.storeId),
        eq(billDrafts.terminalId, terminal.id),
        eq(billDrafts.shiftId, shiftId),
        eq(billDrafts.state, "draft"),
      ),
    )
    .get();
}
export function billOf(tx: DbExecutor, draftId: string): BillResult {
  const draft = tx.select().from(billDrafts).where(eq(billDrafts.id, draftId)).get();
  if (!draft) return notFound;
  return { ok: true, bill: toBill(tx, draft) };
}
function isWholeUnitLine(unit: NewLine["unit"], packQtyMilli: number): boolean {
  return unit === "piece" || packQtyMilli !== WHOLE_UNIT_MILLI;
}
function findSellable(tx: DbExecutor, storeId: string, productId: string) {
  return tx
    .select({
      id: products.id,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      unit: products.unit,
      salePricePaisa: products.salePricePaisa,
      isSystem: products.isSystem,
      isActive: products.isActive,
    })
    .from(products)
    .where(
      and(eq(products.id, productId), eq(products.storeId, storeId), isNull(products.deletedAt)),
    )
    .get();
}

export function ensureDraft(context: Context): DraftRow {
  const { tx, session, terminal, shiftId } = context;
  return (
    currentDraft(context) ??
    tx
      .insert(billDrafts)
      .values({
        storeId: terminal.storeId,
        terminalId: terminal.id,
        shiftId,
        createdBy: session.userId,
      })
      .returning()
      .get()
  );
}

export function runInShift<T extends { ok: boolean }>(
  database: VendoraDatabase,
  sessions: SessionStore,
  fn: (context: Context) => T,
): T | typeof noOpenShift {
  const session = requireSession(sessions);
  return database.db.transaction((tx) => {
    const terminal = currentTerminal(tx);
    try {
      const shift = requireOpenShift(tx, terminal.id);
      return fn({ tx, session, terminal, shiftId: shift.id });
    } catch (error) {
      if (error instanceof NoOpenShiftError) return noOpenShift;
      throw error;
    }
  });
}

export function createBillDraftsService({
  database,
  audit,
  sessions,
  now = () => new Date(),
}: BillDraftsDeps) {
  const { db } = database;

  function inShift<T extends { ok: boolean }>(fn: (context: Context) => T): T | typeof noOpenShift {
    return runInShift(database, sessions, fn);
  }

  function touch(tx: DbExecutor, draftId: string): void {
    tx.update(billDrafts).set({ updatedAt: now() }).where(eq(billDrafts.id, draftId)).run();
  }

  function addLine(context: Context, input: NewLine): BillResult {
    const { tx, terminal } = context;
    const draft = ensureDraft(context);

    const mergeable =
      input.unit === "piece" &&
      input.priceType === "original" &&
      input.scaleSource === null &&
      input.miscName === null &&
      !input.isReturn;
    if (mergeable) {
      const match = tx
        .select({ id: billDraftLines.id, qtyMilli: billDraftLines.qtyMilli })
        .from(billDraftLines)
        .where(
          and(
            eq(billDraftLines.draftId, draft.id),
            isNull(billDraftLines.deletedAt),
            eq(billDraftLines.productId, input.productId),
            eq(billDraftLines.unitPricePaisa, input.unitPricePaisa),
            eq(billDraftLines.packQtyMilli, input.packQtyMilli),
            eq(billDraftLines.priceType, "original"),
            eq(billDraftLines.isReturn, false),
            isNull(billDraftLines.scaleSource),
            isNull(billDraftLines.miscName),
            isNull(billDraftLines.lineDiscountKind),
          ),
        )
        .orderBy(asc(billDraftLines.position))
        .get();
      if (match) {
        tx.update(billDraftLines)
          .set({ qtyMilli: match.qtyMilli + input.qtyMilli, updatedAt: now() })
          .where(eq(billDraftLines.id, match.id))
          .run();
        touch(tx, draft.id);
        return billOf(tx, draft.id);
      }
    }

    const position =
      (tx
        .select({ top: sql<number>`coalesce(max(${billDraftLines.position}), -1)` })
        .from(billDraftLines)
        .where(eq(billDraftLines.draftId, draft.id))
        .get()?.top ?? -1) + 1;
    tx.insert(billDraftLines)
      .values({
        storeId: terminal.storeId,
        terminalId: terminal.id,
        draftId: draft.id,
        position,
        productId: input.productId,
        qtyMilli: input.isReturn ? -input.qtyMilli : input.qtyMilli,
        isReturn: input.isReturn,
        unitPricePaisa: input.unitPricePaisa,
        priceType: input.priceType,
        packQtyMilli: input.packQtyMilli,
        barcode: input.barcode,
        scaleSource: input.scaleSource,
        miscName: input.miscName,
      })
      .run();
    touch(tx, draft.id);
    return billOf(tx, draft.id);
  }

  function scan(input: ScanInput): BillResult {
    return inShift((context) => {
      const { tx, terminal } = context;
      const isReturn = input.isReturn ?? false;
      const found = lookupBarcode(database, terminal.storeId, input.barcode);
      if (!found) return productNotFound;
      const product = findSellable(tx, terminal.storeId, found.product.id);
      if (!product || product.isSystem || !product.isActive) return productNotFound;
      const code = input.barcode.trim();

      if (found.source === "barcode") {
        if (
          product.unit !== "piece" &&
          found.packQtyMilli === WHOLE_UNIT_MILLI &&
          found.packPricePaisa === null
        ) {
          return {
            ok: false,
            reason: "needs-weight",
            message: checkoutMessages.needsWeight,
            product: {
              id: product.id,
              name: product.nameEn,
              nameUr: product.nameUr,
              unit: product.unit,
              unitPricePaisa: product.salePricePaisa,
            },
          } as const;
        }
        const unitPricePaisa =
          found.packPricePaisa ??
          divRoundHalfUp(
            BigInt(product.salePricePaisa) * BigInt(found.packQtyMilli),
            BigInt(WHOLE_UNIT_MILLI),
          );
        return addLine(context, {
          productId: product.id,
          unit: product.unit,
          qtyMilli: WHOLE_UNIT_MILLI,
          isReturn,
          unitPricePaisa,
          priceType: "original",
          packQtyMilli: found.packQtyMilli,
          barcode: code,
          scaleSource: null,
          miscName: null,
        });
      }

      const base = {
        productId: product.id,
        unit: product.unit,
        isReturn,
        unitPricePaisa: product.salePricePaisa,
        priceType: "original",
        packQtyMilli: WHOLE_UNIT_MILLI,
        barcode: code,
        miscName: null,
      } as const;
      if (found.scale.kind === "weight") {
        return addLine(context, {
          ...base,
          qtyMilli: found.scale.qtyMilli,
          scaleSource: "weight",
        });
      }

      if (product.salePricePaisa === 0) return noPrice;
      const qtyMilli =
        product.unit === "piece"
          ? WHOLE_UNIT_MILLI
          : divRoundHalfUp(BigInt(found.scale.pricePaisa) * 1000n, BigInt(product.salePricePaisa));
      if (qtyMilli === 0) return noPrice;
      return addLine(context, { ...base, qtyMilli, scaleSource: "price" });
    });
  }

  function addProduct(input: AddProductInput): BillResult {
    return inShift((context) => {
      const { tx, terminal } = context;
      const qtyMilli = input.qtyMilli ?? WHOLE_UNIT_MILLI;
      const product = findSellable(tx, terminal.storeId, input.productId);
      if (!product || product.isSystem || !product.isActive) return productNotFound;
      if (isWholeUnitLine(product.unit, WHOLE_UNIT_MILLI) && qtyMilli % WHOLE_UNIT_MILLI !== 0) {
        return wholeUnits;
      }
      return addLine(context, {
        productId: product.id,
        unit: product.unit,
        qtyMilli,
        isReturn: input.isReturn ?? false,
        unitPricePaisa: product.salePricePaisa,
        priceType: "original",
        packQtyMilli: WHOLE_UNIT_MILLI,
        barcode: null,
        scaleSource: null,
        miscName: null,
      });
    });
  }

  function addMisc(input: AddMiscInput): BillResult {
    return inShift((context) => {
      const misc = getMiscItem(database, context.terminal.storeId);
      if (!misc) return miscDisabled;
      return addLine(context, {
        productId: misc.id,
        unit: "piece",
        qtyMilli: WHOLE_UNIT_MILLI,
        isReturn: input.isReturn ?? false,
        unitPricePaisa: input.pricePaisa,
        priceType: "manual",
        packQtyMilli: WHOLE_UNIT_MILLI,
        barcode: null,
        scaleSource: null,
        miscName: input.name,
      });
    });
  }

  function updateLine(input: UpdateLineInput): BillResult {
    return inShift((context) => {
      const { tx } = context;
      const found = findLine(context, input.lineId);
      if (!found) return notFound;
      const { line, unit } = found;
      const linked = line.refundedLineId
        ? loadLinkedOriginals(tx, [line.refundedLineId]).get(line.refundedLineId)
        : undefined;

      if (linked && input.unitPricePaisa !== undefined) return linkedReturn;
      if (
        line.scaleSource === "price" &&
        (input.qtyMilli !== undefined || input.unitPricePaisa !== undefined)
      ) {
        return scaleLine;
      }
      if (input.discount && line.isReturn) return returnDiscount;
      if (
        input.qtyMilli !== undefined &&
        isWholeUnitLine(unit, line.packQtyMilli) &&
        input.qtyMilli % WHOLE_UNIT_MILLI !== 0
      ) {
        return wholeUnits;
      }
      if (linked && input.qtyMilli !== undefined && input.qtyMilli > leftQtyMilli(linked)) {
        return refuse(
          "return-over-sold",
          returnMessages.overSold(Math.max(0, leftQtyMilli(linked)), unit),
        );
      }

      const changes: Partial<typeof billDraftLines.$inferInsert> = { updatedAt: now() };
      if (input.qtyMilli !== undefined) {
        changes.qtyMilli = line.isReturn ? -input.qtyMilli : input.qtyMilli;
      }
      if (input.unitPricePaisa !== undefined) {
        changes.unitPricePaisa = input.unitPricePaisa;
        changes.priceType = "manual";
      }
      if (input.discount !== undefined) {
        const columns = discountColumns(input.discount);
        changes.lineDiscountKind = columns.kind;
        changes.lineDiscountValue = columns.value;
      }
      tx.update(billDraftLines).set(changes).where(eq(billDraftLines.id, line.id)).run();
      touch(tx, found.draft.id);
      return billOf(tx, found.draft.id);
    });
  }

  function toggleReturn({ lineId }: { lineId: string }): BillResult {
    return inShift((context) => {
      const { tx } = context;
      const found = findLine(context, lineId);
      if (!found) return notFound;
      const { line } = found;
      if (line.refundedLineId) return linkedReturn;
      tx.update(billDraftLines)
        .set({
          isReturn: !line.isReturn,
          qtyMilli: -line.qtyMilli,
          isDamaged: false,
          lineDiscountKind: null,
          lineDiscountValue: null,
          updatedAt: now(),
        })
        .where(eq(billDraftLines.id, line.id))
        .run();
      touch(tx, found.draft.id);
      return billOf(tx, found.draft.id);
    });
  }

  function setDamaged(input: SetDamagedInput): BillResult {
    return inShift((context) => {
      const { tx } = context;
      const found = findLine(context, input.lineId);
      if (!found) return notFound;
      if (!found.line.isReturn) return notReturn;
      if (found.isSystem) return noStock;
      tx.update(billDraftLines)
        .set({ isDamaged: input.damaged, updatedAt: now() })
        .where(eq(billDraftLines.id, found.line.id))
        .run();
      touch(tx, found.draft.id);
      return billOf(tx, found.draft.id);
    });
  }

  function deleteLine({ lineId }: { lineId: string }): BillResult {
    return inShift((context) => {
      const { tx, session } = context;
      const found = findLine(context, lineId);
      if (!found) return notFound;
      const before = toBill(tx, found.draft).lines.find((line) => line.id === lineId);

      tx.update(billDraftLines)
        .set({ deletedAt: now(), deletedBy: session.userId, updatedAt: now() })
        .where(eq(billDraftLines.id, lineId))
        .run();
      touch(tx, found.draft.id);
      audit.record(
        {
          action: "line_delete",
          actorUserId: session.userId,
          entityType: "bill_draft_line",
          entityId: lineId,
          details: {
            draftId: found.draft.id,
            productId: found.line.productId,
            qtyMilli: found.line.qtyMilli,
            grossPaisa: before?.grossPaisa ?? 0,
          },
        },
        tx,
      );
      return billOf(tx, found.draft.id);
    });
  }

  function setBillDiscount(input: SetBillDiscountInput): BillResult {
    return inShift((context) => {
      const { tx } = context;
      const draft = findDraft(context, input.draftId);
      if (!draft) return notFound;
      const columns = discountColumns(input.discount);
      tx.update(billDrafts)
        .set({
          billDiscountKind: columns.kind,
          billDiscountValue: columns.value,
          updatedAt: now(),
        })
        .where(eq(billDrafts.id, draft.id))
        .run();
      return billOf(tx, draft.id);
    });
  }

  function hold(input: HoldInput): ActionResult {
    return inShift((context) => {
      const { tx } = context;
      const draft = findDraft(context, input.draftId);
      if (!draft) return notFound;
      if (liveLineCount(tx, draft.id) === 0) return emptyBill;
      const changes: Partial<typeof billDrafts.$inferInsert> = { updatedAt: now() };
      if (draft.heldAt === null) changes.heldAt = now();
      tx.update(billDrafts).set(changes).where(eq(billDrafts.id, draft.id)).run();
      return { ok: true } as const;
    });
  }

  function resume({ draftId }: { draftId: string }): BillResult {
    return inShift((context) => {
      const { tx } = context;
      const target = findDraft(context, draftId);
      if (!target) return notFound;
      if (target.heldAt === null) return billOf(tx, target.id);

      const current = currentDraft(context);
      if (current) {
        if (liveLineCount(tx, current.id) > 0) {
          tx.update(billDrafts)
            .set({ heldAt: now(), updatedAt: now() })
            .where(eq(billDrafts.id, current.id))
            .run();
        } else {
          tx.update(billDrafts)
            .set({ state: "cancelled", updatedAt: now() })
            .where(eq(billDrafts.id, current.id))
            .run();
        }
      }
      tx.update(billDrafts)
        .set({ heldAt: null, updatedAt: now() })
        .where(eq(billDrafts.id, target.id))
        .run();
      return billOf(tx, target.id);
    });
  }

  function discard({ draftId }: { draftId: string }): ActionResult {
    return inShift((context) => {
      const { tx, session } = context;
      const draft = findDraft(context, draftId);
      if (!draft) return notFound;
      const lineCount = liveLineCount(tx, draft.id);
      const totalPaisa = lineCount > 0 ? toBill(tx, draft).totals.totalPaisa : 0;
      tx.update(billDrafts)
        .set({ state: "cancelled", updatedAt: now() })
        .where(eq(billDrafts.id, draft.id))
        .run();
      if (lineCount > 0) {
        audit.record(
          {
            action: "bill_discard",
            actorUserId: session.userId,
            entityType: "bill_draft",
            entityId: draft.id,
            details: { lineCount, totalPaisa },
          },
          tx,
        );
      }
      return { ok: true } as const;
    });
  }

  function currentOrNull(): CurrentBill {
    const session = requireSession(sessions);
    return db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      try {
        const shift = requireOpenShift(tx, terminal.id);
        const draft = currentDraft({ tx, session, terminal, shiftId: shift.id });
        return { bill: draft ? toBill(tx, draft) : null };
      } catch (error) {
        if (error instanceof NoOpenShiftError) return { bill: null };
        throw error;
      }
    });
  }

  function listHeld(): HeldBillSummary[] {
    requireSession(sessions);
    return db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      try {
        const shift = requireOpenShift(tx, terminal.id);
        return nonEmptyDrafts(tx, shift.id, true).map((row) =>
          summaryOf(tx, row.draft, row.lineCount),
        );
      } catch (error) {
        if (error instanceof NoOpenShiftError) return [];
        throw error;
      }
    });
  }

  function heldBillsFor(shiftId: string): HeldBillSummary[] {
    return nonEmptyDrafts(db, shiftId, false).map((row) => summaryOf(db, row.draft, row.lineCount));
  }

  return {
    current: currentOrNull,
    scan,
    addProduct,
    addMisc,
    updateLine,
    toggleReturn,
    setDamaged,
    deleteLine,
    setBillDiscount,
    hold,
    resume,
    listHeld,
    discard,
    heldBillsFor,
  };
}

export type BillDraftsService = ReturnType<typeof createBillDraftsService>;
