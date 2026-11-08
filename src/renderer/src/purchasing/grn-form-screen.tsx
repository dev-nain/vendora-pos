import { ChevronLeftIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { GoodsReceivedNote, PostGoodsReceivedInput } from "@shared/goods-received";
import type { BarcodeLookup } from "@shared/products";
import type { Supplier } from "@shared/suppliers";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ScanField, useDebouncedValue } from "../billing/scan-field";
import { formatQuantity } from "../lib/quantity";
import { DiscardChangesDialog } from "../products/discard-changes-dialog";
import { ErrorLine } from "../users/form-parts";
import {
  addDirectLine,
  addOrderLine,
  buildGrnPayload,
  defaultCostPaisa,
  emptyGrnForm,
  grnFormFromOrder,
  grnTotal,
  isGrnFormDirty,
  matchScan,
  overReceipts,
  scanQtyMilli,
  type GrnFormErrors,
  type GrnFormValues,
  type GrnLineDraft,
  type GrnSource,
} from "./grn-form";
import { ONE_UNIT_MILLI, type OrderProduct } from "./order-form";
import type { LeaveGuard } from "./order-form-screen";
import { OrderLines } from "./order-lines";
import { PostGrnDialog } from "./post-grn-dialog";
import { ProductPicker, type ProductPickerHandle } from "./product-picker";
import { useLineScanner } from "./use-line-scanner";

interface GrnFormScreenProps {
  source: GrnSource;
  registerLeaveGuard: (guard: LeaveGuard | null) => void;
  onBack: () => void;
  onPosted: (note: GoodsReceivedNote) => void;
  onSessionEnded: () => void;
}

const noErrors: GrnFormErrors = { line: {} };

const SEARCH_DEBOUNCE_MS = 150;

const initialValues = (source: GrnSource): GrnFormValues =>
  source.kind === "order" ? grnFormFromOrder(source.order) : emptyGrnForm();

function focusQty(root: HTMLElement | null, key: string) {
  const input = root?.querySelector<HTMLInputElement>(
    `input[data-column="qty"][data-line-key="${key}"]`,
  );
  input?.focus();
  input?.select();
}

function focusFirstInvalid(root: HTMLElement | null) {
  requestAnimationFrame(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

function QtyNote({ line }: { line: GrnLineDraft }) {
  if (line.remainingQtyMilli === null) return null;
  const over = overReceipts([line])[0];
  if (over) {
    return (
      <p className="m-0 flex items-center justify-start gap-100 text-left text-[length:var(--font-size-300)] font-medium text-warning">
        <TriangleAlertIcon
          aria-hidden="true"
          size={14}
          strokeWidth={2}
          className="shrink-0 text-icon-warning"
        />
        {formatQuantity(over.extraMilli, over.unit)} more than ordered
      </p>
    );
  }
  return (
    <p className="m-0 text-left text-[length:var(--font-size-300)] text-secondary">
      {formatQuantity(line.remainingQtyMilli, line.unit)} remaining
    </p>
  );
}

const renderQtyNote = (line: GrnLineDraft) => <QtyNote line={line} />;

export function GrnFormScreen({
  source,
  registerLeaveGuard,
  onBack,
  onPosted,
  onSessionEnded,
}: GrnFormScreenProps) {
  const [initial] = useState<GrnFormValues>(() => initialValues(source));
  const [values, setValues] = useState<GrnFormValues>(initial);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [errors, setErrors] = useState<GrnFormErrors>(noErrors);
  const [formError, setFormError] = useState<string | null>(null);
  const [discard, setDiscard] = useState<{ proceed: () => void } | null>(null);
  const [postPayload, setPostPayload] = useState<PostGoodsReceivedInput | null>(null);
  const [scanText, setScanText] = useState("");
  const [hasResults, setHasResults] = useState(false);
  const query = useDebouncedValue(scanText, SEARCH_DEBOUNCE_MS);

  const formRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<ProductPickerHandle | null>(null);
  const linesRef = useRef<GrnLineDraft[]>(initial.lines);

  const isOrder = source.kind === "order";
  const dirty = isGrnFormDirty(initial, values);
  const dialogOpen = discard !== null || postPayload !== null;

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setFormError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  useEffect(() => {
    if (!isOrder) {
      window.vendora.suppliers.list({ includeArchived: false }).then(setSuppliers).catch(fail);
    }
  }, [isOrder, fail]);

  useEffect(() => {
    const target = isOrder
      ? formRef.current?.querySelector<HTMLElement>('input[aria-label="Supplier invoice number"]')
      : formRef.current?.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    target?.focus();
  }, [isOrder]);

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

  const commitLines = useCallback((lines: GrnLineDraft[]) => {
    linesRef.current = lines;
    setValues((current) => ({ ...current, lines }));
  }, []);

  const receiveProduct = useCallback(
    async (product: OrderProduct, startQtyMilli: number): Promise<string | null> => {
      const match = matchScan(linesRef.current, source, product.id);
      if (match.kind === "not-on-order") return `${product.nameEn} isn't on this order.`;
      let key: string;
      if (match.kind === "existing") {
        key = match.key;
      } else if (match.kind === "order-line") {
        const added = addOrderLine(linesRef.current, match.line, startQtyMilli);
        flushSync(() => commitLines(added.lines));
        key = added.key;
      } else {
        const { unitCostPaisa } = await window.vendora.goodsReceived.lastCost(product.id);
        const added = addDirectLine(
          linesRef.current,
          product,
          startQtyMilli,
          defaultCostPaisa(unitCostPaisa, product),
        );
        flushSync(() => commitLines(added.lines));
        key = added.key;
      }
      setFormError(null);
      focusQty(formRef.current, key);
      return null;
    },
    [source, commitLines],
  );

  const onLookup = useCallback(
    (lookup: BarcodeLookup) => receiveProduct(lookup.product, scanQtyMilli(lookup)),
    [receiveProduct],
  );

  const { notice, clearNotice, enqueue } = useLineScanner({
    enabled: true,
    paused: dialogOpen,
    onLookup,
    onSessionEnded,
  });

  const pickProduct = (product: OrderProduct) => {
    setScanText("");
    receiveProduct(product, ONE_UNIT_MILLI).catch(fail);
  };

  const openPost = useCallback(() => {
    const built = buildGrnPayload(source, values);
    if (!built.ok) {
      setErrors(built.errors);
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors(noErrors);
    setPostPayload(built.payload);
  }, [source, values]);

  useEffect(() => {
    if (dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        scanRef.current?.focus();
        scanRef.current?.select();
      } else if (event.key === "F12") {
        event.preventDefault();
        openPost();
      } else if (event.key === "Escape" && !event.defaultPrevented) {
        const target = event.target as Element | null;
        if (target?.closest('[aria-expanded="true"], [role="listbox"], [role="dialog"]')) return;
        event.preventDefault();
        requestLeave(onBack);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const setField = (patch: Partial<GrnFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  const supplierItems = (suppliers ?? []).map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
  }));

  const title =
    source.kind === "order" ? `Receive from ${source.order.orderNo}` : "Receive directly";
  const selectedSupplier =
    source.kind === "order"
      ? source.order.supplierName
      : (supplierItems.find((item) => item.value === values.supplierId)?.label ?? "");

  return (
    <div ref={formRef} className="flex flex-col gap-500">
      <div className="flex flex-col items-start gap-300">
        <Button type="button" variant="ghost" size="sm" onClick={() => requestLeave(onBack)}>
          <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Goods received
          <Kbd>Esc</Kbd>
        </Button>
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          {title}
        </h1>
      </div>
      {formError ? <ErrorLine>{formError}</ErrorLine> : null}
      <div className="grid grid-cols-[320px_320px] items-start gap-400">
        <Field invalid={errors.supplier !== undefined}>
          <FieldLabel>Supplier</FieldLabel>
          {source.kind === "order" ? (
            <p className="m-0 min-h-[var(--height-control-md)] content-center text-[length:var(--font-size-400)] text-foreground">
              {source.order.supplierName}
            </p>
          ) : (
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
          )}
          {errors.supplier ? <FieldError>{errors.supplier}</FieldError> : null}
          {!isOrder && suppliers !== null && suppliers.length === 0 ? (
            <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
              Add a supplier first, under Suppliers.
            </p>
          ) : null}
        </Field>
        <Field invalid={errors.invoice !== undefined}>
          <FieldLabel>Supplier invoice number</FieldLabel>
          <Input
            aria-label="Supplier invoice number"
            aria-invalid={errors.invoice !== undefined}
            autoComplete="off"
            maxLength={64}
            value={values.supplierInvoiceNo}
            className="tabular-nums"
            onChange={(event) => setField({ supplierInvoiceNo: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                focusScan();
              }
            }}
          />
          {errors.invoice ? <FieldError>{errors.invoice}</FieldError> : null}
        </Field>
      </div>
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
      <OrderLines
        label="Goods received lines"
        lines={values.lines}
        editable
        errors={errors.line}
        {...(isOrder ? { qtyNote: renderQtyNote } : {})}
        onChange={(key, patch) =>
          commitLines(
            linesRef.current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
          )
        }
        onRemove={(key) => commitLines(linesRef.current.filter((line) => line.key !== key))}
        onReturnToScan={focusScan}
      />
      {errors.lines ? <ErrorLine>{errors.lines}</ErrorLine> : null}
      <div className="sticky bottom-0 flex items-center justify-end gap-400 border-t border-line bg-surface py-300">
        <span className="text-[length:var(--font-size-450)] text-secondary">Total</span>
        <span className="text-[length:var(--font-size-550)] font-semibold tabular-nums text-foreground">
          {formatRupees(grnTotal(values.lines))}
        </span>
        <Button type="button" onClick={openPost}>
          Post
          <Kbd>F12</Kbd>
        </Button>
      </div>
      <PostGrnDialog
        payload={postPayload}
        summary={{
          supplierName: selectedSupplier,
          supplierInvoiceNo: values.supplierInvoiceNo.trim(),
          lineCount: postPayload?.lines.length ?? 0,
          totalPaisa: grnTotal(values.lines),
          overReceipts: overReceipts(values.lines),
        }}
        finalFocus={scanRef}
        onClose={() => setPostPayload(null)}
        onPosted={onPosted}
        onSessionEnded={onSessionEnded}
      />
      <DiscardChangesDialog
        noun="goods received note"
        open={discard !== null}
        onKeepEditing={() => setDiscard(null)}
        onDiscard={() => {
          const pending = discard;
          setDiscard(null);
          pending?.proceed();
        }}
      />
    </div>
  );
}
