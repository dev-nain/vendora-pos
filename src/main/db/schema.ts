import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { productUnits, type ProductUnit } from "../../shared/products";
import { uuidv7 } from "./id";

export { productUnits, type ProductUnit };

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

export const stores = sqliteTable(
  "stores",
  {
    id: id(),
    name: text("name"),
    standardTaxRateBps: integer("standard_tax_rate_bps").notNull().default(1800),
    scaleWeightPrefix: text("scale_weight_prefix").notNull().default("21"),
    scalePricePrefix: text("scale_price_prefix").notNull().default("22"),
    miscItemEnabled: integer("misc_item_enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
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

export const schema = {
  stores,
  terminals,
  users,
  auditLog,
  categories,
  taxCategories,
  products,
  productBarcodes,
};
