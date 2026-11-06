import { and, eq, inArray, isNull } from "drizzle-orm";
import type {
  NegativeStockQuery,
  NegativeStockResult,
  StockHistoryQuery,
  StockHistoryResult,
  StockListQuery,
  StockListResult,
} from "../../shared/inventory";
import { productMessages } from "../../shared/products";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { products, saleLines, sales, users } from "../db/schema";
import { listNegativeStock } from "./negative-stock";
import { searchProducts } from "./product-search";
import type { StockService } from "./stock";
import { stockValuePaisa } from "./stock-value";

interface InventoryDeps {
  database: VendoraDatabase;
  sessions: SessionStore;
  stock: StockService;
}

export function createInventoryService({ database, sessions, stock }: InventoryDeps) {
  const { db } = database;

  function list(input: StockListQuery): StockListResult {
    const session = requireSession(sessions);
    const { items, total } = searchProducts(database, session.storeId, input);
    if (items.length === 0) return { items: [], total };

    const costs = new Map(
      db
        .select({ id: products.id, costPaisa: products.costPaisa })
        .from(products)
        .where(
          inArray(
            products.id,
            items.map((item) => item.id),
          ),
        )
        .all()
        .map((row) => [row.id, row.costPaisa]),
    );

    return {
      items: items.map((item) => {
        const costPaisa = costs.get(item.id) ?? 0;
        return {
          ...item,
          costPaisa,
          stockValuePaisa: stockValuePaisa(item.onHandMilli, costPaisa),
        };
      }),
      total,
    };
  }

  function history(input: StockHistoryQuery): StockHistoryResult {
    const session = requireSession(sessions);
    const product = db
      .select({
        id: products.id,
        nameEn: products.nameEn,
        nameUr: products.nameUr,
        unit: products.unit,
        costPaisa: products.costPaisa,
      })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.storeId, session.storeId),
          isNull(products.deletedAt),
          eq(products.isSystem, false),
        ),
      )
      .get();
    if (!product) {
      return { ok: false, reason: "not-found", message: productMessages.notFound };
    }

    const onHandMilli = stock.onHand(product.id);
    const fetched = stock.history({
      productId: product.id,
      limit: input.limit + 1,
      offset: input.offset,
    });
    const page = fetched.slice(0, input.limit);

    const actorIds = [...new Set(page.map((movement) => movement.actorUserId))];
    const userNames = new Map(
      actorIds.length === 0
        ? []
        : db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, actorIds))
            .all()
            .map((row) => [row.id, row.displayName]),
    );

    const lineIds = [
      ...new Set(
        page.flatMap((movement) =>
          movement.sourceType === "sale_line" && movement.sourceId ? [movement.sourceId] : [],
        ),
      ),
    ];
    const invoiceNos = new Map(
      lineIds.length === 0
        ? []
        : db
            .select({ lineId: saleLines.id, invoiceNo: sales.invoiceNo })
            .from(saleLines)
            .innerJoin(sales, eq(sales.id, saleLines.saleId))
            .where(inArray(saleLines.id, lineIds))
            .all()
            .map((row) => [row.lineId, row.invoiceNo]),
    );

    return {
      ok: true,
      product: {
        id: product.id,
        nameEn: product.nameEn,
        nameUr: product.nameUr,
        unit: product.unit,
        onHandMilli,
        costPaisa: product.costPaisa,
        stockValuePaisa: stockValuePaisa(onHandMilli, product.costPaisa),
      },
      movements: page.map((movement) => {
        const invoiceNo =
          movement.sourceType === "sale_line" && movement.sourceId
            ? invoiceNos.get(movement.sourceId)
            : undefined;
        return {
          id: movement.id,
          createdAt: movement.createdAt.toISOString(),
          type: movement.type,
          qtyMilli: movement.qtyMilli,
          unitCostPaisa: movement.unitCostPaisa,
          reason: movement.reason,
          userName: userNames.get(movement.actorUserId) ?? "",
          source: invoiceNo ? `Invoice ${invoiceNo}` : null,
        };
      }),
      hasMore: fetched.length > input.limit,
    };
  }

  function negativeStock(input: NegativeStockQuery): NegativeStockResult {
    const session = requireSession(sessions);
    const all = listNegativeStock(database, session.storeId);
    return { items: all.slice(input.offset, input.offset + input.limit), total: all.length };
  }

  return { list, history, negativeStock };
}
export type InventoryService = ReturnType<typeof createInventoryService>;
