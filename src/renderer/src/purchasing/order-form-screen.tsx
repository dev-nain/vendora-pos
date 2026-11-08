import { ChevronLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { LowStockItem } from "@shared/inventory";
import type { BarcodeLookup } from "@shared/products";
import { isPurchaseOrderEditable, type PurchaseOrder } from "@shared/purchase-orders";
import type { Supplier } from "@shared/suppliers";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { controlClasses } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ScanField, useDebouncedValue } from "../billing/scan-field";
import { DiscardChangesDialog } from "../products/discard-changes-dialog";
import { ErrorLine } from "../users/form-parts";
import { formatRupees } from "../lib/money";
import { CancelOrderDialog } from "./cancel-order-dialog";
import {
  ONE_UNIT_MILLI,
  addFromLookup,
  addProduct,
  buildOrderPayload,
  emptyOrderForm,
  formFromLowStock,
  formFromOrder,
  isOrderFormDirty,
  orderTotal,
  type OrderFormErrors,
  type OrderFormValues,
  type OrderLineDraft,
  type OrderProduct,
} from "./order-form";
import { OrderLines } from "./order-lines";
import { OrderStatusBadge } from "./order-status-badge";
import { ProductPicker, type ProductPickerHandle } from "./product-picker";
import { useLineScanner } from "./use-line-scanner";

export type OrderSeed = readonly LowStockItem[];

export type LeaveGuard = (proceed: () => void) => boolean;

interface OrderFormScreenProps {
  orderId: string | null;
  seed: OrderSeed | null;
  registerLeaveGuard: (guard: LeaveGuard | null) => void;
  onBack: () => void;
  onSessionEnded: () => void;
}

const noErrors: OrderFormErrors = { line: {} };

const SEARCH_DEBOUNCE_MS = 150;

const cancellable = (order: PurchaseOrder) =>
  order.status !== "cancelled" && order.status !== "received";

export function OrderFormScreen({
  orderId,
  seed,
  registerLeaveGuard,
  onBack,
  onSessionEnded,
}: OrderFormScreenProps) {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "failed">(orderId ? "loading" : "ready");
  const [initial, setInitial] = useState<OrderFormValues>(emptyOrderForm);
  const [values, setValues] = useState<OrderFormValues>(() =>
    seed ? formFromLowStock(seed) : emptyOrderForm(),
  );
  const [errors, setErrors] = useState<OrderFormErrors>(noErrors);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState<{ proceed: () => void } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [scanText, setScanText] = useState("");
  const [hasResults, setHasResults] = useState(false);
  const query = useDebouncedValue(scanText, SEARCH_DEBOUNCE_MS);

  const formRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<ProductPickerHandle | null>(null);

  const dirty = isOrderFormDirty(initial, values);
  const editable = order === null || isPurchaseOrderEditable(order);
  const dialogOpen = discard !== null || cancelOpen;

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setFormError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const applyOrder = useCallback((next: PurchaseOrder) => {
    const form = formFromOrder(next);
    setOrder(next);
    setInitial(form);
    setValues(form);
    setErrors(noErrors);
  }, []);

  const reloadOrder = useCallback(
    (id: string) =>
      window.vendora.purchaseOrders
        .get(id)
        .then((result) => {
          if (result.ok) {
            applyOrder(result.order);
            setLoad("ready");
          } else {
            setFormError(result.message);
            setLoad("failed");
          }
        })
        .catch((cause: unknown) => {
          setLoad("failed");
          fail(cause);
        }),
    [applyOrder, fail],
  );

  useEffect(() => {
    if (orderId) void reloadOrder(orderId);
  }, [orderId, reloadOrder]);

  useEffect(() => {
    window.vendora.suppliers.list({ includeArchived: false }).then(setSuppliers).catch(fail);
  }, [fail]);

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (dirty) setDiscard({ proceed });
      else proceed();
    },
    [dirty],
  );

  useEffect(() => {
    registerLeaveGuard((proceed) => {
      if (!dirty) return false;
      setDiscard({ proceed });
      return true;
    });
    return () => registerLeaveGuard(null);
  }, [dirty, registerLeaveGuard]);

  const focusScan = useCallback(() => scanRef.current?.focus(), []);

  useEffect(() => {
    if (orderId === null) {
      formRef.current?.querySelector<HTMLElement>('[data-slot="select-trigger"]')?.focus();
    }
  }, [orderId]);

  const addLines = useCallback(
    (productId: string, add: (lines: OrderLineDraft[]) => OrderLineDraft[], focusQty: boolean) => {
      flushSync(() => {
        setValues((current) => ({ ...current, lines: add(current.lines) }));
        setStatus(null);
      });
      if (!focusQty) return;
      const input = formRef.current?.querySelector<HTMLInputElement>(
        `input[data-column="qty"][data-product-id="${productId}"]`,
      );
      input?.focus();
      input?.select();
    },
    [],
  );

  const onLookup = useCallback(
    async (lookup: BarcodeLookup) => {
      addLines(
        lookup.product.id,
        (lines) => addFromLookup(lines, lookup).lines,
        lookup.source === "scale",
      );
      return null;
    },
    [addLines],
  );

  const { notice, clearNotice, enqueue } = useLineScanner({
    enabled: editable,
    paused: dialogOpen,
    onLookup,
    onSessionEnded,
  });

  const pickProduct = (product: OrderProduct) => {
    setScanText("");
    addLines(product.id, (lines) => addProduct(lines, product, ONE_UNIT_MILLI).lines, true);
  };

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const saveIfDirty = async (): Promise<PurchaseOrder | null> => {
    if (order && (!editable || !dirty)) return order;
    const built = buildOrderPayload(values);
    if (!built.ok) {
      setErrors(built.errors);
      setStatus(null);
      setFormError(null);
      focusFirstInvalid();
      return null;
    }
    setErrors(noErrors);
    try {
      const result = order
        ? await window.vendora.purchaseOrders.update({ id: order.id, ...built.payload })
        : await window.vendora.purchaseOrders.create(built.payload);
      if (result.ok) {
        applyOrder(result.order);
        setFormError(null);
        setStatus(`Saved ${result.order.orderNo}.`);
        return result.order;
      }
      setStatus(null);
      setFormError(result.message);
      if (order && (result.reason === "not-found" || result.reason === "not-editable")) {
        await reloadOrder(order.id);
      }
    } catch (cause) {
      fail(cause);
    }
    return null;
  };

  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const save = () => run(async () => void (await saveIfDirty()));

  const confirm = () =>
    run(async () => {
      const saved = await saveIfDirty();
      if (!saved) return;
      try {
        const result = await window.vendora.purchaseOrders.confirm(saved.id);
        if (result.ok) {
          applyOrder(result.order);
          setFormError(null);
          setStatus(`Confirmed ${result.order.orderNo}.`);
        } else {
          setStatus(null);
          setFormError(result.message);
          await reloadOrder(saved.id);
        }
      } catch (cause) {
        fail(cause);
      }
    });

  const print = () =>
    run(async () => {
      const saved = await saveIfDirty();
      if (!saved) return;
      try {
        const result = await window.vendora.purchaseOrders.print(saved.id);
        if (!result.ok) {
          setStatus(null);
          setFormError(result.message);
        }
      } catch (cause) {
        fail(cause);
      }
    });

  const savePdf = () =>
    run(async () => {
      const saved = await saveIfDirty();
      if (!saved) return;
      try {
        const result = await window.vendora.purchaseOrders.savePdf(saved.id);
        if (!result.ok) {
          setStatus(null);
          setFormError(result.message);
        } else if (result.status === "saved") {
          setFormError(null);
          setStatus(`PDF saved to ${result.path}.`);
        }
      } catch (cause) {
        fail(cause);
      }
    });

  useEffect(() => {
    if (dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2" && editable) {
        event.preventDefault();
        scanRef.current?.focus();
        scanRef.current?.select();
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "s") {
          event.preventDefault();
          void (event.shiftKey ? savePdf() : save());
        } else if (key === "p" && !event.shiftKey) {
          event.preventDefault();
          void print();
        }
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest('[aria-expanded="true"], [role="listbox"], [role="dialog"]')) return;
      event.preventDefault();
      requestLeave(onBack);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const setField = (patch: Partial<OrderFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setStatus(null);
  };

  const updateLines = (update: (lines: OrderLineDraft[]) => OrderLineDraft[]) => {
    setValues((current) => ({ ...current, lines: update(current.lines) }));
    setStatus(null);
  };

  const supplierItems = [
    ...(suppliers ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name })),
    ...(order && !(suppliers ?? []).some((supplier) => supplier.id === order.supplierId)
      ? [{ value: order.supplierId, label: order.supplierName }]
      : []),
  ];

  const title = order ? order.orderNo : "New purchase order";

  if (load === "loading") return <p className="m-0 text-secondary">Loading purchase order…</p>;

  return (
    <div ref={formRef} className="flex flex-col gap-500">
      <div className="flex flex-col items-start gap-300">
        <Button type="button" variant="ghost" size="sm" onClick={() => requestLeave(onBack)}>
          <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Purchase orders
          <Kbd>Esc</Kbd>
        </Button>
        <div className="flex items-center gap-300">
          <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
            {title}
          </h1>
          {order ? <OrderStatusBadge status={order.status} /> : null}
        </div>
      </div>
      {load === "failed" ? (
        formError ? (
          <ErrorLine>{formError}</ErrorLine>
        ) : null
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-300">
            {editable ? (
              <Button
                type="button"
                disabled={busy}
                focusableWhenDisabled
                onClick={() => void save()}
              >
                Save
                <Kbd>Ctrl+S</Kbd>
              </Button>
            ) : null}
            {editable && (order === null || order.status === "draft") ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                focusableWhenDisabled
                onClick={() => void confirm()}
              >
                Confirm order
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              focusableWhenDisabled
              onClick={() => void print()}
            >
              Print
              <Kbd>Ctrl+P</Kbd>
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              focusableWhenDisabled
              onClick={() => void savePdf()}
            >
              Save as PDF
              <Kbd>Ctrl+Shift+S</Kbd>
            </Button>
            {order && cancellable(order) ? (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                disabled={busy}
                focusableWhenDisabled
                onClick={() => setCancelOpen(true)}
              >
                Cancel order
              </Button>
            ) : null}
          </div>
          {formError ? <ErrorLine>{formError}</ErrorLine> : null}
          <p role="status" aria-live="polite" className="m-0 text-secondary empty:hidden">
            {status}
          </p>
          <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-400">
            <Field invalid={errors.supplier !== undefined}>
              <FieldLabel>Supplier</FieldLabel>
              {editable ? (
                <Select
                  items={supplierItems}
                  value={values.supplierId}
                  onValueChange={(next) => {
                    if (typeof next === "string") setField({ supplierId: next });
                  }}
                >
                  <SelectTrigger aria-label="Supplier" aria-invalid={errors.supplier !== undefined}>
                    <SelectValue placeholder="Pick a supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {supplierItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="m-0 min-h-[var(--height-control-md)] content-center text-[length:var(--font-size-400)] text-foreground">
                  {order?.supplierName}
                </p>
              )}
              {errors.supplier ? <FieldError>{errors.supplier}</FieldError> : null}
              {editable && suppliers !== null && suppliers.length === 0 ? (
                <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                  Add a supplier first, under Suppliers.
                </p>
              ) : null}
            </Field>
            {editable ? (
              <div className="relative">
                <ScanField
                  ref={scanRef}
                  value={scanText}
                  notice={notice}
                  canMoveToGrid={hasResults}
                  onChange={setScanText}
                  onSubmit={enqueue}
                  onMoveToGrid={() => pickerRef.current?.focusFirst()}
                  onDismissNotice={() => (notice ? clearNotice() : requestLeave(onBack))}
                />
                <ProductPicker
                  ref={pickerRef}
                  query={query}
                  visible={scanText.trim() !== ""}
                  onPick={pickProduct}
                  onReturnToScan={focusScan}
                  onResultsChange={setHasResults}
                  onSessionEnded={onSessionEnded}
                />
              </div>
            ) : null}
          </div>
          <OrderLines
            lines={values.lines}
            editable={editable}
            errors={errors.line}
            onChange={(key, patch) =>
              updateLines((lines) =>
                lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
              )
            }
            onRemove={(key) => updateLines((lines) => lines.filter((line) => line.key !== key))}
            onReturnToScan={focusScan}
          />
          {errors.lines ? <ErrorLine>{errors.lines}</ErrorLine> : null}
          <Field invalid={errors.notes !== undefined}>
            <FieldLabel>Notes</FieldLabel>
            {editable ? (
              <textarea
                aria-label="Notes"
                aria-invalid={errors.notes !== undefined}
                autoComplete="off"
                rows={3}
                maxLength={500}
                value={values.notes}
                className={cn(controlClasses, "resize-none py-200")}
                onChange={(event) => setField({ notes: event.target.value })}
              />
            ) : (
              <p className="m-0 whitespace-pre-wrap text-[length:var(--font-size-400)] text-foreground">
                {values.notes || <span className="text-tertiary">—</span>}
              </p>
            )}
            {errors.notes ? <FieldError>{errors.notes}</FieldError> : null}
          </Field>
          <div className="sticky bottom-0 flex items-center justify-end gap-400 border-t border-line bg-surface py-300">
            <span className="text-[length:var(--font-size-450)] text-secondary">Total</span>
            <span className="text-[length:var(--font-size-550)] font-semibold tabular-nums text-foreground">
              {formatRupees(orderTotal(values.lines))}
            </span>
          </div>
        </>
      )}
      <DiscardChangesDialog
        noun="purchase order"
        open={discard !== null}
        onKeepEditing={() => setDiscard(null)}
        onDiscard={() => {
          const pending = discard;
          setDiscard(null);
          setInitial(values);
          pending?.proceed();
        }}
      />
      {order ? (
        <CancelOrderDialog
          order={order}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          onCancelled={(cancelled) => {
            applyOrder(cancelled);
            setFormError(null);
            setStatus(`Cancelled ${cancelled.orderNo}.`);
          }}
          onStale={() => void reloadOrder(order.id)}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
