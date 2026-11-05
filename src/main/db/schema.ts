import { sql, type SQL } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { paymentMethods, type PaymentMethod } from "../../shared/checkout";
import { productUnits, type ProductUnit } from "../../shared/products";
import { printerKinds, printModes, type PaperWidthMm } from "../../shared/settings";
import { uuidv7 } from "./id";

export { paymentMethods, productUnits, type PaymentMethod, type ProductUnit };

const id = () => text("id").primaryKey().$defaultFn(uuidv7);
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

const isInteger = (column: AnySQLiteColumn) => sql`${column} = CAST(${column} AS INTEGER)`;
const isNullableInteger = (column: AnySQLiteColumn) =>
  sql`(${column} IS NULL OR ${column} = CAST(${column} AS INTEGER))`;
const allIntegers = (columns: AnySQLiteColumn[], nullable: AnySQLiteColumn[] = []) =>
  sql.join([...columns.map(isInteger), ...nullable.map(isNullableInteger)], sql` AND `);
const inList = (column: AnySQLiteColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
const discountRange = (kind: AnySQLiteColumn, value: AnySQLiteColumn) =>
  sql`${kind} IS NULL OR (${kind} = 'amount' AND ${value} >= 0) OR (${kind} = 'percent' AND ${value} BETWEEN 0 AND 10000)`;

export const saleTypes = ["sale", "refund"] as const;
export type SaleType = (typeof saleTypes)[number];

export const billDraftStates = ["draft", "paid", "cancelled"] as const;
export type BillDraftState = (typeof billDraftStates)[number];

export const discountKinds = ["amount", "percent"] as const;
export type DiscountKind = (typeof discountKinds)[number];

export const linePriceTypes = ["original", "manual"] as const;
export type LinePriceType = (typeof linePriceTypes)[number];

export const scaleSources = ["weight", "price"] as const;
export type ScaleSource = (typeof scaleSources)[number];

export const stores = sqliteTable(
  "stores",
  {
    id: id(),
    name: text("name"),
    standardTaxRateBps: integer("standard_tax_rate_bps").notNull().default(1800),
    scaleWeightPrefix: text("scale_weight_prefix").notNull().default("21"),
    scalePricePrefix: text("scale_price_prefix").notNull().default("22"),
    miscItemEnabled: integer("misc_item_enabled", { mode: "boolean" }).notNull().default(false),
    shiftVarianceWarnPaisa: integer("shift_variance_warn_paisa").notNull().default(0),
    pricesIncludeTax: integer("prices_include_tax", { mode: "boolean" }).notNull().default(true),
    cashRoundingEnabled: integer("cash_rounding_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    cashRoundingPaisa: integer("cash_rounding_paisa").notNull().default(100),
    cashRoundingCashOnly: integer("cash_rounding_cash_only", { mode: "boolean" })
      .notNull()
      .default(true),
    address: text("address"),
    phone: text("phone"),
    ntn: text("ntn"),
    strn: text("strn"),
    receiptHeaderEn: text("receipt_header_en"),
    receiptHeaderUr: text("receipt_header_ur"),
    receiptFooterEn: text("receipt_footer_en"),
    receiptFooterUr: text("receipt_footer_ur"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "stores_cash_rounding_paisa_check",
      sql`${isInteger(t.cashRoundingPaisa)} AND ${t.cashRoundingPaisa} > 0`,
    ),
    check("stores_standard_tax_rate_bps_check", sql`${t.standardTaxRateBps} BETWEEN 0 AND 10000`),
    check(
      "stores_scale_weight_prefix_check",
      sql`length(${t.scaleWeightPrefix}) = 2 AND substr(${t.scaleWeightPrefix}, 1, 1) BETWEEN '0' AND '9' AND substr(${t.scaleWeightPrefix}, 2, 1) BETWEEN '0' AND '9'`,
    ),
    check(
      "stores_scale_price_prefix_check",
      sql`length(${t.scalePricePrefix}) = 2 AND substr(${t.scalePricePrefix}, 1, 1) BETWEEN '0' AND '9' AND substr(${t.scalePricePrefix}, 2, 1) BETWEEN '0' AND '9'`,
    ),
  ],
);

export const terminals = sqliteTable(
  "terminals",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    code: text("code").notNull(),
    fbrPosId: text("fbr_pos_id"),
    printerKind: text("printer_kind", { enum: printerKinds }).notNull().default("none"),
    printerName: text("printer_name"),
    printerHost: text("printer_host"),
    printerPort: integer("printer_port"),
    paperWidthMm: integer("paper_width_mm").$type<PaperWidthMm>().notNull().default(80),
    printMode: text("print_mode", { enum: printModes }).notNull().default("print"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("terminals_store_id_code_unique").on(t.storeId, t.code)],
);

export const users = sqliteTable(
  "users",
  {
    id: id(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    pinHash: text("pin_hash").notNull(),
    failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
    pinRetryAfter: integer("pin_retry_after", { mode: "timestamp_ms" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_username_lower_unique").on(sql`lower(${t.username})`)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: text("details"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_actor_created_at_idx").on(t.actorUserId, t.createdAt),
    index("audit_log_action_created_at_idx").on(t.action, t.createdAt),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    name: text("name").notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("categories_store_id_name_lower_unique")
      .on(t.storeId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const taxCategories = sqliteTable(
  "tax_categories",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    name: text("name").notNull(),
    rateBps: integer("rate_bps"),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("tax_categories_store_id_name_lower_unique")
      .on(t.storeId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check(
      "tax_categories_rate_bps_check",
      sql`${t.rateBps} IS NULL OR ${t.rateBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    nameEn: text("name_en").notNull(),
    nameUr: text("name_ur"),
    searchText: text("search_text").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    taxCategoryId: text("tax_category_id")
      .notNull()
      .references(() => taxCategories.id),
    brand: text("brand"),
    unit: text("unit", { enum: productUnits }).notNull(),
    internalCode: text("internal_code"),
    costPaisa: integer("cost_paisa").notNull(),
    salePricePaisa: integer("sale_price_paisa").notNull(),
    mrpPaisa: integer("mrp_paisa"),
    pctCode: text("pct_code"),
    isThirdSchedule: integer("is_third_schedule", { mode: "boolean" }).notNull().default(false),
    lowStockThresholdMilli: integer("low_stock_threshold_milli"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("products_unit_check", sql`${t.unit} IN ('piece', 'kg', 'litre')`),
    check("products_cost_paisa_check", sql`${t.costPaisa} >= 0`),
    check("products_sale_price_paisa_check", sql`${t.salePricePaisa} >= 0`),
    check("products_mrp_paisa_check", sql`${t.mrpPaisa} IS NULL OR ${t.mrpPaisa} >= 0`),
    uniqueIndex("products_store_id_internal_code_unique")
      .on(t.storeId, t.internalCode)
      .where(sql`${t.deletedAt} IS NULL`),
    index("products_store_id_search_text_idx").on(t.storeId, t.searchText),
    index("products_category_id_idx").on(t.categoryId),
  ],
);

export const productBarcodes = sqliteTable(
  "product_barcodes",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    barcode: text("barcode").notNull(),
    packQtyMilli: integer("pack_qty_milli").notNull().default(1000),
    salePricePaisa: integer("sale_price_paisa"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("product_barcodes_pack_qty_milli_check", sql`${t.packQtyMilli} > 0`),
    check(
      "product_barcodes_sale_price_paisa_check",
      sql`${t.salePricePaisa} IS NULL OR ${t.salePricePaisa} >= 0`,
    ),
    uniqueIndex("product_barcodes_store_id_barcode_unique")
      .on(t.storeId, t.barcode)
      .where(sql`${t.deletedAt} IS NULL`),
    index("product_barcodes_product_id_idx").on(t.productId),
  ],
);
export const stockMovementTypes = [
  "opening",
  "sale",
  "return",
  "receipt",
  "adjustment",
  "stocktake",
  "damage",
] as const;
export type StockMovementType = (typeof stockMovementTypes)[number];

export const stockMovementReasons = ["damage", "expiry", "theft", "correction"] as const;
export type StockMovementReason = (typeof stockMovementReasons)[number];

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type", { enum: stockMovementTypes }).notNull(),
    qtyMilli: integer("qty_milli").notNull(),
    unitCostPaisa: integer("unit_cost_paisa").notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    reason: text("reason", { enum: stockMovementReasons }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "stock_movements_type_check",
      sql`${t.type} IN ('opening', 'sale', 'return', 'receipt', 'adjustment', 'stocktake', 'damage')`,
    ),
    check(
      "stock_movements_reason_check",
      sql`(${t.type} IN ('adjustment', 'damage') AND ${t.reason} IS NOT NULL AND ${t.reason} IN ('damage', 'expiry', 'theft', 'correction')) OR (${t.type} NOT IN ('adjustment', 'damage') AND ${t.reason} IS NULL)`,
    ),
    check("stock_movements_qty_milli_check", sql`${t.qtyMilli} <> 0`),
    check("stock_movements_unit_cost_paisa_check", sql`${t.unitCostPaisa} >= 0`),
    check("stock_movements_source_check", sql`(${t.sourceType} IS NULL) = (${t.sourceId} IS NULL)`),
    index("stock_movements_product_id_idx").on(t.productId),
    index("stock_movements_product_id_created_at_idx").on(t.productId, t.createdAt),
  ],
);

export const cashDenominations = sqliteTable(
  "cash_denominations",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    valuePaisa: integer("value_paisa").notNull(),
    kind: text("kind", { enum: ["note", "coin"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("cash_denominations_value_paisa_check", sql`${t.valuePaisa} > 0`),
    check("cash_denominations_kind_check", sql`${t.kind} IN ('note', 'coin')`),
    uniqueIndex("cash_denominations_store_id_value_paisa_unique")
      .on(t.storeId, t.valuePaisa)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const shifts = sqliteTable(
  "shifts",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    openedBy: text("opened_by")
      .notNull()
      .references(() => users.id),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    openingFloatPaisa: integer("opening_float_paisa").notNull(),
    closedBy: text("closed_by").references(() => users.id),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    countedCashPaisa: integer("counted_cash_paisa"),
    expectedCashPaisa: integer("expected_cash_paisa"),
    variancePaisa: integer("variance_paisa"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shifts_opening_float_paisa_check", sql`${t.openingFloatPaisa} >= 0`),
    check(
      "shifts_counted_cash_paisa_check",
      sql`${t.countedCashPaisa} IS NULL OR ${t.countedCashPaisa} >= 0`,
    ),
    check("shifts_closed_pair_check", sql`(${t.closedAt} IS NULL) = (${t.closedBy} IS NULL)`),
    uniqueIndex("shifts_terminal_open_unique")
      .on(t.terminalId)
      .where(sql`${t.closedAt} IS NULL`),
    index("shifts_terminal_id_closed_at_idx").on(t.terminalId, t.closedAt),
  ],
);

export const shiftCashMoves = sqliteTable(
  "shift_cash_moves",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id),
    kind: text("kind", { enum: ["in", "out"] }).notNull(),
    amountPaisa: integer("amount_paisa").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedBy: text("deleted_by").references(() => users.id),
  },
  (t) => [
    check("shift_cash_moves_kind_check", sql`${t.kind} IN ('in', 'out')`),
    check("shift_cash_moves_amount_paisa_check", sql`${t.amountPaisa} > 0`),
    check(
      "shift_cash_moves_deleted_pair_check",
      sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`,
    ),
    index("shift_cash_moves_shift_id_idx").on(t.shiftId),
  ],
);

export const shiftCashCounts = sqliteTable(
  "shift_cash_counts",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id),
    denominationId: text("denomination_id")
      .notNull()
      .references(() => cashDenominations.id),
    valuePaisa: integer("value_paisa").notNull(),
    count: integer("count").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shift_cash_counts_value_paisa_check", sql`${t.valuePaisa} > 0`),
    check("shift_cash_counts_count_check", sql`${t.count} > 0`),
    index("shift_cash_counts_shift_id_idx").on(t.shiftId),
  ],
);

export const billDrafts = sqliteTable(
  "bill_drafts",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id),
    state: text("state", { enum: billDraftStates }).notNull().default("draft"),
    heldAt: integer("held_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    billDiscountKind: text("bill_discount_kind", { enum: discountKinds }),
    billDiscountValue: integer("bill_discount_value"),
    buyerName: text("buyer_name"),
    buyerNtn: text("buyer_ntn"),
    buyerCnic: text("buyer_cnic"),
    buyerPhone: text("buyer_phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("bill_drafts_state_check", inList(t.state, billDraftStates)),
    check(
      "bill_drafts_bill_discount_kind_check",
      sql`${t.billDiscountKind} IS NULL OR ${inList(t.billDiscountKind, discountKinds)}`,
    ),
    check("bill_drafts_integers_check", allIntegers([], [t.billDiscountValue])),
    check(
      "bill_drafts_bill_discount_pair_check",
      sql`(${t.billDiscountKind} IS NULL) = (${t.billDiscountValue} IS NULL)`,
    ),
    check(
      "bill_drafts_bill_discount_range_check",
      discountRange(t.billDiscountKind, t.billDiscountValue),
    ),
    index("bill_drafts_shift_id_state_idx").on(t.shiftId, t.state),
    index("bill_drafts_terminal_id_state_idx").on(t.terminalId, t.state),
  ],
);

export const billDraftLines = sqliteTable(
  "bill_draft_lines",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    draftId: text("draft_id")
      .notNull()
      .references(() => billDrafts.id),
    position: integer("position").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    qtyMilli: integer("qty_milli").notNull(),
    isReturn: integer("is_return", { mode: "boolean" }).notNull().default(false),
    isDamaged: integer("is_damaged", { mode: "boolean" }).notNull().default(false),
    refundedLineId: text("refunded_line_id").references((): AnySQLiteColumn => saleLines.id),
    unitPricePaisa: integer("unit_price_paisa").notNull(),
    priceType: text("price_type", { enum: linePriceTypes }).notNull().default("original"),
    lineDiscountKind: text("line_discount_kind", { enum: discountKinds }),
    lineDiscountValue: integer("line_discount_value"),
    packBarcodeId: text("pack_barcode_id").references(() => productBarcodes.id),
    packQtyMilli: integer("pack_qty_milli").notNull().default(1000),
    barcode: text("barcode"),
    scaleSource: text("scale_source", { enum: scaleSources }),
    miscName: text("misc_name"),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedBy: text("deleted_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "bill_draft_lines_integers_check",
      allIntegers(
        [t.position, t.qtyMilli, t.unitPricePaisa, t.packQtyMilli],
        [t.lineDiscountValue],
      ),
    ),
    check("bill_draft_lines_position_check", sql`${t.position} >= 0`),
    check(
      "bill_draft_lines_qty_milli_check",
      sql`(${t.isReturn} = 1 AND ${t.qtyMilli} < 0) OR (${t.isReturn} = 0 AND ${t.qtyMilli} > 0)`,
    ),
    check(
      "bill_draft_lines_refunded_line_id_check",
      sql`${t.refundedLineId} IS NULL OR ${t.isReturn} = 1`,
    ),
    check("bill_draft_lines_is_damaged_check", sql`${t.isDamaged} = 0 OR ${t.isReturn} = 1`),
    check("bill_draft_lines_unit_price_paisa_check", sql`${t.unitPricePaisa} >= 0`),
    check("bill_draft_lines_pack_qty_milli_check", sql`${t.packQtyMilli} > 0`),
    check("bill_draft_lines_price_type_check", inList(t.priceType, linePriceTypes)),
    check(
      "bill_draft_lines_scale_source_check",
      sql`${t.scaleSource} IS NULL OR ${inList(t.scaleSource, scaleSources)}`,
    ),
    check(
      "bill_draft_lines_line_discount_kind_check",
      sql`${t.lineDiscountKind} IS NULL OR ${inList(t.lineDiscountKind, discountKinds)}`,
    ),
    check(
      "bill_draft_lines_line_discount_pair_check",
      sql`(${t.lineDiscountKind} IS NULL) = (${t.lineDiscountValue} IS NULL)`,
    ),
    check(
      "bill_draft_lines_line_discount_range_check",
      discountRange(t.lineDiscountKind, t.lineDiscountValue),
    ),
    check(
      "bill_draft_lines_deleted_pair_check",
      sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`,
    ),
    uniqueIndex("bill_draft_lines_draft_id_position_unique").on(t.draftId, t.position),
  ],
);

export const sales = sqliteTable(
  "sales",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id),
    draftId: text("draft_id")
      .notNull()
      .references(() => billDrafts.id),
    invoiceNo: text("invoice_no").notNull(),
    type: text("type", { enum: saleTypes }).notNull(),
    refundedSaleId: text("refunded_sale_id").references((): AnySQLiteColumn => sales.id),
    cashierUserId: text("cashier_user_id")
      .notNull()
      .references(() => users.id),
    pricesIncludeTax: integer("prices_include_tax", { mode: "boolean" }).notNull(),
    subtotalPaisa: integer("subtotal_paisa").notNull(),
    discountPaisa: integer("discount_paisa").notNull(),
    taxPaisa: integer("tax_paisa").notNull(),
    roundingPaisa: integer("rounding_paisa").notNull(),
    totalPaisa: integer("total_paisa").notNull(),
    deletedLineCount: integer("deleted_line_count").notNull().default(0),
    buyerName: text("buyer_name"),
    buyerNtn: text("buyer_ntn"),
    buyerCnic: text("buyer_cnic"),
    buyerPhone: text("buyer_phone"),
    createdAt: createdAt(),
  },
  (t) => [
    check("sales_type_check", inList(t.type, saleTypes)),
    check(
      "sales_integers_check",
      allIntegers([
        t.subtotalPaisa,
        t.discountPaisa,
        t.taxPaisa,
        t.roundingPaisa,
        t.totalPaisa,
        t.deletedLineCount,
      ]),
    ),
    check("sales_deleted_line_count_check", sql`${t.deletedLineCount} >= 0`),
    check("sales_type_total_check", sql`(${t.type} = 'refund') = (${t.totalPaisa} < 0)`),
    check(
      "sales_refunded_sale_id_check",
      sql`${t.refundedSaleId} IS NULL OR ${t.refundedSaleId} <> ${t.id}`,
    ),
    check("sales_invoice_no_check", sql`length(${t.invoiceNo}) > 0`),
    uniqueIndex("sales_draft_id_unique").on(t.draftId),
    uniqueIndex("sales_invoice_no_terminal_id_unique").on(t.invoiceNo, t.terminalId),
    uniqueIndex("sales_id_refunded_sale_id_unique").on(t.id, t.refundedSaleId),
    index("sales_store_id_created_at_idx").on(t.storeId, t.createdAt),
    index("sales_shift_id_idx").on(t.shiftId),
    index("sales_terminal_id_created_at_idx").on(t.terminalId, t.createdAt),
    index("sales_refunded_sale_id_idx").on(t.refundedSaleId),
  ],
);

export const saleLines = sqliteTable(
  "sale_lines",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    position: integer("position").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    nameEn: text("name_en").notNull(),
    nameUr: text("name_ur"),
    unit: text("unit", { enum: productUnits }).notNull(),
    qtyMilli: integer("qty_milli").notNull(),
    isReturn: integer("is_return", { mode: "boolean" }).notNull(),
    unitPricePaisa: integer("unit_price_paisa").notNull(),
    mrpPaisa: integer("mrp_paisa"),
    costPaisa: integer("cost_paisa").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    isThirdSchedule: integer("is_third_schedule", { mode: "boolean" }).notNull(),
    pctCode: text("pct_code"),
    grossPaisa: integer("gross_paisa").notNull(),
    lineDiscountPaisa: integer("line_discount_paisa").notNull(),
    billDiscountPaisa: integer("bill_discount_paisa").notNull(),
    discountPaisa: integer("discount_paisa").notNull(),
    taxPaisa: integer("tax_paisa").notNull(),
    totalPaisa: integer("total_paisa").notNull(),
    refundedSaleId: text("refunded_sale_id"),
    refundedLineId: text("refunded_line_id"),
    barcode: text("barcode"),
    packQtyMilli: integer("pack_qty_milli").notNull().default(1000),
    createdAt: createdAt(),
  },
  (t) => {
    const amounts = [
      t.grossPaisa,
      t.lineDiscountPaisa,
      t.billDiscountPaisa,
      t.discountPaisa,
      t.taxPaisa,
      t.totalPaisa,
    ];
    const allAre = (comparison: string) =>
      sql.join(
        amounts.map((amount) => sql`${amount} ${sql.raw(comparison)}`),
        sql` AND `,
      );
    return [
      check("sale_lines_unit_check", inList(t.unit, productUnits)),
      check(
        "sale_lines_integers_check",
        allIntegers(
          [
            t.position,
            t.qtyMilli,
            t.unitPricePaisa,
            t.costPaisa,
            t.taxRateBps,
            ...amounts,
            t.packQtyMilli,
          ],
          [t.mrpPaisa],
        ),
      ),
      check("sale_lines_position_check", sql`${t.position} >= 0`),
      check(
        "sale_lines_signs_check",
        sql`(${t.isReturn} = 1 AND ${t.qtyMilli} < 0 AND ${allAre("<= 0")}) OR (${t.isReturn} = 0 AND ${t.qtyMilli} > 0 AND ${allAre(">= 0")})`,
      ),
      check("sale_lines_unit_price_paisa_check", sql`${t.unitPricePaisa} >= 0`),
      check("sale_lines_cost_paisa_check", sql`${t.costPaisa} >= 0`),
      check("sale_lines_mrp_paisa_check", sql`${t.mrpPaisa} IS NULL OR ${t.mrpPaisa} >= 0`),
      check("sale_lines_tax_rate_bps_check", sql`${t.taxRateBps} BETWEEN 0 AND 10000`),
      check("sale_lines_pack_qty_milli_check", sql`${t.packQtyMilli} > 0`),
      check(
        "sale_lines_discount_sum_check",
        sql`${t.discountPaisa} = ${t.lineDiscountPaisa} + ${t.billDiscountPaisa}`,
      ),
      check(
        "sale_lines_refunded_line_id_check",
        sql`${t.refundedLineId} IS NULL OR ${t.isReturn} = 1`,
      ),
      check(
        "sale_lines_refunded_pair_check",
        sql`(${t.refundedLineId} IS NULL) = (${t.refundedSaleId} IS NULL)`,
      ),
      foreignKey({
        columns: [t.saleId, t.refundedSaleId],
        foreignColumns: [sales.id, sales.refundedSaleId],
        name: "sale_lines_sale_id_refunded_sale_id_fk",
      }),
      foreignKey({
        columns: [t.refundedSaleId, t.refundedLineId],
        foreignColumns: [t.saleId, t.id],
        name: "sale_lines_refunded_sale_id_refunded_line_id_fk",
      }),
      uniqueIndex("sale_lines_sale_id_position_unique").on(t.saleId, t.position),
      uniqueIndex("sale_lines_sale_id_id_unique").on(t.saleId, t.id),
      index("sale_lines_product_id_created_at_idx").on(t.productId, t.createdAt),
      index("sale_lines_refunded_line_id_idx").on(t.refundedLineId),
    ];
  },
);

export const salePayments = sqliteTable(
  "sale_payments",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    position: integer("position").notNull(),
    method: text("method", { enum: paymentMethods }).notNull(),
    amountPaisa: integer("amount_paisa").notNull(),
    reference: text("reference"),
    isChange: integer("is_change", { mode: "boolean" }).notNull().default(false),
    reversesPaymentId: text("reverses_payment_id"),
    cashierUserId: text("cashier_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("sale_payments_method_check", inList(t.method, paymentMethods)),
    check("sale_payments_integers_check", allIntegers([t.position, t.amountPaisa])),
    check("sale_payments_position_check", sql`${t.position} >= 0`),
    check("sale_payments_amount_paisa_check", sql`${t.amountPaisa} <> 0`),
    check(
      "sale_payments_is_change_check",
      sql`${t.isChange} = 0 OR (${t.method} = 'cash' AND ${t.amountPaisa} < 0)`,
    ),
    check(
      "sale_payments_reference_check",
      sql`${t.reference} IS NULL OR (${t.method} <> 'cash' AND length(${t.reference}) BETWEEN 1 AND 64)`,
    ),
    check(
      "sale_payments_reverses_payment_id_check",
      sql`${t.reversesPaymentId} IS NULL OR ${t.reversesPaymentId} <> ${t.id}`,
    ),
    foreignKey({
      columns: [t.saleId, t.method, t.reversesPaymentId],
      foreignColumns: [t.saleId, t.method, t.id],
      name: "sale_payments_sale_id_method_reverses_payment_id_fk",
    }),
    uniqueIndex("sale_payments_sale_id_position_unique").on(t.saleId, t.position),
    uniqueIndex("sale_payments_sale_id_method_id_unique").on(t.saleId, t.method, t.id),
    uniqueIndex("sale_payments_reverses_payment_id_unique").on(t.reversesPaymentId),
  ],
);

export const receiptPrints = sqliteTable(
  "receipt_prints",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id),
    printedBy: text("printed_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("receipt_prints_sale_id_idx").on(t.saleId)],
);

export const terminalInvoiceSequences = sqliteTable(
  "terminal_invoice_sequences",
  {
    terminalId: text("terminal_id")
      .primaryKey()
      .references(() => terminals.id),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    nextSeq: integer("next_seq").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "terminal_invoice_sequences_next_seq_check",
      sql`${isInteger(t.nextSeq)} AND ${t.nextSeq} >= 1`,
    ),
  ],
);

export const schema = {
  stores,
  terminals,
  users,
  auditLog,
  categories,
  taxCategories,
  products,
  productBarcodes,
  stockMovements,
  cashDenominations,
  shifts,
  shiftCashMoves,
  shiftCashCounts,
  billDrafts,
  billDraftLines,
  sales,
  saleLines,
  salePayments,
  receiptPrints,
  terminalInvoiceSequences,
};
