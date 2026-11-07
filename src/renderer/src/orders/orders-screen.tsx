import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { printerMessages, type PrintResult } from "@shared/receipt";
import type { OrderDetail as OrderDetailData, OrderSummary, SalesListQuery } from "@shared/sales";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { createBurstDetector } from "../billing/scan-burst";
import {
  dateQueryFrom,
  moveOrderSelection,
  searchQueryFrom,
  selectAfterSearch,
} from "./invoice-search";
import { OrderDetail } from "./order-detail";
import { OrderList } from "./order-list";
import { ReturnPanel } from "./return-panel";
import type { Hint } from "../shell/hint-bar";

const baseHints: Hint[] = [["Ctrl+L", "Switch user"]];
const listHints: Hint[] = [
  ["Enter", "Search"],
  ["↑/↓", "Select"],
  ["Ctrl+P", "Reprint"],
  ["Ctrl+R", "Return items"],
  ["Esc", "Back"],
  ...baseHints,
];
const returnHints: Hint[] = [["↑/↓", "Line"], ["Enter", "Refund"], ["Esc", "Back"], ...baseHints];

type Source = "shift" | "invoice" | "date";

const emptyText: Record<Source, string> = {
  shift: "No sales in this shift yet.",
  invoice: "No sale with that invoice number.",
  date: "No sales on that day.",
};

interface OrdersScreenProps {
  active: boolean;
  initialInvoiceNo: string | null;
  onBack: () => void;
  onSessionEnded: () => void;
  onPrinterChanged: () => void;
  onHintsChange: (hints: Hint[]) => void;
  onReturned: () => void;
}

export function OrdersScreen({
  active,
  initialInvoiceNo,
  onBack,
  onSessionEnded,
  onPrinterChanged,
  onHintsChange,
  onReturned,
}: OrdersScreenProps) {
  const [source, setSource] = useState<Source>("shift");
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetailData | null>(null);
  const [searchText, setSearchText] = useState(initialInvoiceNo ?? "");
  const [dateText, setDateText] = useState("");
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [returnable, setReturnable] = useState<{ id: string; hasLeft: boolean } | null>(null);
  const [returning, setReturning] = useState(false);
  const request = useRef(0);
  const searchField = useRef<HTMLInputElement | null>(null);
  const running = useRef(false);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
    },
    [onSessionEnded],
  );

  const load = useCallback(
    (query: SalesListQuery, next: Source) => {
      const mine = ++request.current;
      window.vendora.sales
        .list(query)
        .then((list) => {
          if (mine !== request.current) return;
          setSource(next);
          setLoadFailed(false);
          setOrders(list);
          setSelectedId(selectAfterSearch(list));
          setResult(null);
        })
        .catch((cause: unknown) => {
          if (mine !== request.current) return;
          fail(cause);
          setLoadFailed(true);
        });
    },
    [fail],
  );

  const showShift = useCallback(() => {
    setSearchText("");
    setDateText("");
    load({ scope: "shift" }, "shift");
  }, [load]);

  const runSearch = useCallback(
    (text: string) => {
      const query = searchQueryFrom(text);
      setDateText("");
      if (query) load(query, "invoice");
      else showShift();
    },
    [load, showShift],
  );

  const firstInvoiceNo = useRef(initialInvoiceNo);
  useEffect(() => {
    const query = firstInvoiceNo.current ? searchQueryFrom(firstInvoiceNo.current) : null;
    if (query) load(query, "invoice");
    else load({ scope: "shift" }, "shift");
  }, [load]);

  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    window.vendora.sales
      .get(selectedId)
      .then((found) => {
        if (live) setDetail(found.ok ? found.sale : null);
      })
      .catch((cause: unknown) => {
        if (live) fail(cause);
      });
    return () => {
      live = false;
    };
  }, [selectedId, fail]);

  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    window.vendora.returns
      .returnable(selectedId)
      .then((found) => {
        if (live && found.ok) {
          setReturnable({
            id: selectedId,
            hasLeft: found.lines.some((line) => line.leftQtyMilli > 0),
          });
        }
      })
      .catch((cause: unknown) => {
        if (live) fail(cause);
      });
    return () => {
      live = false;
    };
  }, [selectedId, fail]);

  useEffect(() => {
    onHintsChange(returning ? returnHints : listHints);
  }, [returning, onHintsChange]);

  const canReturn = selectedId !== null && returnable?.id === selectedId && returnable.hasLeft;

  const startReturn = useCallback(() => {
    if (canReturn) setReturning(true);
  }, [canReturn]);

  const leaveReturn = useCallback(() => {
    setReturning(false);
    requestAnimationFrame(() => document.getElementById("return-items-button")?.focus());
  }, []);

  const reprint = useCallback(() => {
    if (!selectedId || running.current) return;
    running.current = true;
    setPrinting(true);
    window.vendora.receipts
      .print(selectedId)
      .then(async (outcome) => {
        setResult(outcome);
        if (outcome.successful) {
          const found = await window.vendora.sales.get(selectedId);
          if (found.ok) setDetail(found.sale);
        }
      })
      .catch((cause: unknown) => {
        fail(cause);
        setResult({ successful: false, canRetry: true, message: printerMessages.error });
      })
      .finally(() => {
        running.current = false;
        setPrinting(false);
        onPrinterChanged();
      });
  }, [selectedId, fail, onPrinterChanged]);

  const pickOrder = useCallback((id: string) => {
    setSelectedId(id);
    setResult(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (returning) {
        if (event.key === "Escape") {
          event.preventDefault();
          leaveReturn();
        }
        return;
      }
      const plainCtrl = event.ctrlKey && !event.altKey && !event.metaKey;
      if (plainCtrl && event.key.toLowerCase() === "p") {
        event.preventDefault();
        reprint();
      } else if (plainCtrl && event.key.toLowerCase() === "r") {
        event.preventDefault();
        startReturn();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onBack();
      } else if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        (event.target as HTMLElement | null)?.getAttribute("type") !== "date"
      ) {
        event.preventDefault();
        setSelectedId((current) =>
          moveOrderSelection(orders ?? [], current, event.key === "ArrowDown" ? 1 : -1),
        );
        setResult(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, orders, returning, reprint, startReturn, leaveReturn, onBack]);

  useEffect(() => {
    if (!active) return;
    const detector = createBurstDetector();
    const onKeyDown = (event: KeyboardEvent) => {
      const { scan } = detector.feed(event.key, event.timeStamp);
      if (scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      setReturning(false);
      setSearchText(scan);
      runSearch(scan);
      searchField.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, runSearch]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[var(--height-row)] items-center gap-400 border-b border-line px-600">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back
          <Kbd>Esc</Kbd>
        </Button>
        <h1 className="m-0 text-[length:var(--font-size-550)] font-semibold text-foreground">
          Orders
        </h1>
      </div>
      {returning && selectedId ? (
        <ReturnPanel
          saleId={selectedId}
          onBack={leaveReturn}
          onReturned={onReturned}
          onSessionEnded={onSessionEnded}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px]">
          <section aria-label="Sales" className="flex min-h-0 flex-col gap-400 p-600">
            <div className="flex items-center gap-200">
              <Input
                id="orders-search"
                ref={searchField}
                autoFocus
                aria-label="Invoice number"
                placeholder="Invoice number"
                autoComplete="off"
                maxLength={32}
                value={searchText}
                className="min-h-[var(--height-control-lg)] min-w-0 flex-1 text-[length:var(--font-size-450)] tabular-nums"
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runSearch(searchText);
                  }
                }}
              />
              <Input
                type="date"
                aria-label="Sales date"
                value={dateText}
                className="w-[180px] shrink-0"
                onChange={(event) => {
                  const next = event.target.value;
                  setDateText(next);
                  const query = dateQueryFrom(next);
                  if (query) {
                    setSearchText("");
                    load(query, "date");
                  } else if (next === "") {
                    showShift();
                  }
                }}
              />
              <Button variant="secondary" onClick={showShift}>
                Current shift
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadFailed ? (
                <div className="grid justify-items-start gap-200">
                  <p role="alert" className="m-0 text-secondary">
                    {serviceErrorMessage}
                  </p>
                  <Button variant="secondary" onClick={showShift}>
                    Retry
                  </Button>
                </div>
              ) : orders === null ? (
                <p className="m-0 text-secondary">Loading…</p>
              ) : (
                <OrderList
                  orders={orders}
                  selectedId={selectedId}
                  showDate={source !== "shift"}
                  emptyText={emptyText[source]}
                  onSelect={pickOrder}
                />
              )}
            </div>
          </section>
          <aside
            aria-label="Sale details"
            className="min-h-0 overflow-y-auto border-l border-line p-600"
          >
            <OrderDetail
              order={selectedId !== null && detail?.id === selectedId ? detail : null}
              loading={selectedId !== null}
              printing={printing}
              result={result}
              canReturn={canReturn}
              onReprint={reprint}
              onReturn={startReturn}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
