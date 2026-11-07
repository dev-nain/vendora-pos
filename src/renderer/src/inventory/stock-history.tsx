import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  STOCK_HISTORY_MAX_LIMIT,
  type StockHistoryResult,
  type StockMovementRow,
} from "@shared/inventory";
import type { ProductPurchaseHistoryResult } from "@shared/purchase-history";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { signedRupees } from "../billing/bill-format";
import { formatDate, formatDateTime } from "../lib/date-time";
import { formatRupees } from "../lib/money";
import { PurchaseHistoryTable } from "../purchasing/purchase-history-table";
import { ErrorLine } from "../users/form-parts";
import {
  movementReasonLabels,
  movementTypeLabels,
  onHandText,
  signedQuantityText,
} from "./stock-format";

const HISTORY_PAGE_SIZE = Math.min(50, STOCK_HISTORY_MAX_LIMIT);

interface StockHistoryProps {
  productId: string;
  onBack: () => void;
  onSessionEnded: () => void;
}

type View = "movements" | "purchases";

type Loaded = Extract<StockHistoryResult, { ok: true }> | { ok: false; message: string };

const dash = <span className="text-tertiary">—</span>;

const negativeClass = (value: number): string => (value < 0 ? "text-critical" : "");

export function StockHistory({ productId, onBack, onSessionEnded }: StockHistoryProps) {
  const [view, setView] = useState<View>("movements");
  const [page, setPage] = useState(0);
  const [purchasePage, setPurchasePage] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [purchases, setPurchases] = useState<ProductPurchaseHistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.inventory
      .stockHistory({ productId, limit: HISTORY_PAGE_SIZE, offset: page * HISTORY_PAGE_SIZE })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setLoaded(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (isSessionError(cause)) {
          onSessionEnded();
          return;
        }
        setError(serviceErrorMessage);
      });
  }, [productId, page, onSessionEnded]);

  useEffect(load, [load]);

  useEffect(() => {
    let current = true;
    window.vendora.purchaseHistory
      .forProduct({
        productId,
        limit: HISTORY_PAGE_SIZE,
        offset: purchasePage * HISTORY_PAGE_SIZE,
      })
      .then((fetched) => {
        if (current) setPurchases(fetched);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
    return () => {
      current = false;
    };
  }, [productId, purchasePage, onSessionEnded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  const product = loaded?.ok ? loaded.product : null;
  const movements: StockMovementRow[] = loaded?.ok ? loaded.movements : [];
  const hasMore = loaded?.ok ? loaded.hasMore : false;
  const purchaseList = purchases?.ok ? purchases : null;
  const purchasesView = view === "purchases";
  const currentPage = purchasesView ? purchasePage : page;
  const currentHasMore = purchasesView ? (purchaseList?.hasMore ?? false) : hasMore;
  const setCurrentPage = purchasesView ? setPurchasePage : setPage;

  return (
    <div className="flex flex-col gap-500">
      <div>
        <Button variant="secondary" autoFocus onClick={onBack}>
          <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back to stock
          <Kbd>Esc</Kbd>
        </Button>
      </div>
      {product ? (
        <div className="grid gap-100">
          <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
            {product.nameEn}
          </h1>
          {product.nameUr ? (
            <p
              lang="ur"
              dir="rtl"
              className="m-0 font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
            >
              {product.nameUr}
            </p>
          ) : null}
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            On hand{" "}
            <span className={negativeClass(product.onHandMilli)}>
              {onHandText(product.onHandMilli, product.unit)}
            </span>
            {" · "}Average cost {signedRupees(product.costPaisa)}
            {" · "}Stock value{" "}
            <span className={negativeClass(product.stockValuePaisa)}>
              {signedRupees(product.stockValuePaisa)}
            </span>
          </p>
          {purchaseList ? (
            <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
              {purchaseList.lastReceipt
                ? `Last cost ${formatRupees(purchaseList.lastReceipt.unitCostPaisa)} from ${purchaseList.lastReceipt.supplierName} · ${purchaseList.lastReceipt.grnNo} · ${formatDate(purchaseList.lastReceipt.receivedAt)}`
                : "Not received from a supplier yet"}
            </p>
          ) : null}
        </div>
      ) : (
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Movements
        </h1>
      )}
      <div className="flex items-center gap-200">
        {(["movements", "purchases"] as const).map((next) => (
          <Button
            key={next}
            variant={view === next ? "default" : "secondary"}
            aria-pressed={view === next}
            onClick={() => setView(next)}
          >
            {next === "movements" ? "Movements" : "Purchases"}
          </Button>
        ))}
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}
      {purchasesView ? (
        purchases === null ? (
          error ? null : (
            <p className="m-0 text-secondary">Loading…</p>
          )
        ) : !purchases.ok ? (
          <ErrorLine>{purchases.message}</ErrorLine>
        ) : purchases.items.length === 0 ? (
          <p className="m-0 text-secondary">No purchases yet.</p>
        ) : (
          <PurchaseHistoryTable
            items={purchases.items}
            subject="product"
            label="Purchase history"
          />
        )
      ) : loaded === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading…</p>
        )
      ) : !loaded.ok ? (
        <ErrorLine>{loaded.message}</ErrorLine>
      ) : movements.length === 0 ? (
        <p className="m-0 text-secondary">No stock movements yet</p>
      ) : (
        <Table className="table-fixed" aria-label="Stock movements">
          <colgroup>
            <col className="w-[184px]" />
            <col className="w-[104px]" />
            <col className="w-[120px]" />
            <col className="w-[112px]" />
            <col className="w-[96px]" />
            <col />
            <col className="w-[176px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell className="tabular-nums">{formatDateTime(movement.createdAt)}</TableCell>
                <TableCell>{movementTypeLabels[movement.type]}</TableCell>
                <TableCell
                  className={`text-right tabular-nums ${negativeClass(movement.qtyMilli)}`}
                >
                  {product ? signedQuantityText(movement.qtyMilli, product.unit) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {signedRupees(movement.unitCostPaisa)}
                </TableCell>
                <TableCell>
                  {movement.reason ? movementReasonLabels[movement.reason] : dash}
                </TableCell>
                <TableCell className="truncate" title={movement.userName}>
                  {movement.userName || dash}
                </TableCell>
                <TableCell className="truncate" title={movement.source ?? undefined}>
                  {movement.source ?? dash}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {currentPage > 0 || currentHasMore ? (
        <div className="flex items-center justify-end gap-200">
          <Button
            variant="secondary"
            disabled={currentPage === 0}
            focusableWhenDisabled
            onClick={() => setCurrentPage(currentPage - 1)}
          >
            <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={!currentHasMore}
            focusableWhenDisabled
            onClick={() => setCurrentPage(currentPage + 1)}
          >
            Next
            <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
