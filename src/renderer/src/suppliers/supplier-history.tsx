import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SupplierPurchaseHistoryResult } from "@shared/purchase-history";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { PurchaseHistoryTable } from "../purchasing/purchase-history-table";
import { ErrorLine } from "../users/form-parts";

const HISTORY_PAGE_SIZE = 50;

interface SupplierHistoryProps {
  supplierId: string;
  onBack: () => void;
  onSessionEnded: () => void;
}

export function SupplierHistory({ supplierId, onBack, onSessionEnded }: SupplierHistoryProps) {
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState<SupplierPurchaseHistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.purchaseHistory
      .forSupplier({ supplierId, limit: HISTORY_PAGE_SIZE, offset: page * HISTORY_PAGE_SIZE })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setLoaded(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [supplierId, page, onSessionEnded]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  const hasMore = loaded?.ok ? loaded.hasMore : false;

  return (
    <div className="flex flex-col gap-500">
      <div className="flex flex-col items-start gap-300">
        <Button type="button" variant="ghost" size="sm" autoFocus onClick={onBack}>
          <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Suppliers
          <Kbd>Esc</Kbd>
        </Button>
        <div className="grid gap-100">
          <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
            {loaded?.ok ? loaded.supplier.name : "Purchase history"}
          </h1>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Receipts and returns, newest first.
          </p>
        </div>
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}
      {loaded === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading…</p>
        )
      ) : !loaded.ok ? (
        <ErrorLine>{loaded.message}</ErrorLine>
      ) : loaded.items.length === 0 ? (
        <p className="m-0 text-secondary">Nothing received from this supplier yet.</p>
      ) : (
        <PurchaseHistoryTable items={loaded.items} subject="supplier" label="Purchase history" />
      )}
      {page > 0 || hasMore ? (
        <div className="flex items-center justify-end gap-200">
          <Button
            variant="secondary"
            disabled={page === 0}
            focusableWhenDisabled
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={!hasMore}
            focusableWhenDisabled
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
