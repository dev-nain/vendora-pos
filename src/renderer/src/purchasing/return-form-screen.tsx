import { ChevronLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { BarcodeLookup } from "@shared/products";
import {
  purchaseReturnReasonLabels,
  purchaseReturnReasons,
  type PostPurchaseReturnInput,
  type PurchaseReturn,
  type PurchaseReturnReason,
} from "@shared/purchase-returns";
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
import { formatRupees } from "@renderer/lib/money";
import { cn } from "@renderer/lib/utils";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { ScanField, useDebouncedValue } from "../billing/scan-field";
import { formatQuantity } from "../lib/quantity";
import { DiscardChangesDialog } from "../products/discard-changes-dialog";
import { ErrorLine } from "../users/form-parts";
import { scanQtyMilli } from "./grn-form";
import { ONE_UNIT_MILLI, type OrderProduct } from "./order-form";
import type { LeaveGuard } from "./order-form-screen";
import { OrderLines } from "./order-lines";
import { PostReturnDialog } from "./post-return-dialog";
import { ProductPicker, type ProductPickerHandle } from "./product-picker";
import {
  addSupplierLine,
  buildReturnPayload,
  emptyReturnForm,
  isReturnFormDirty,
  matchReturnScan,
  returnFormFromNote,
  returnTotal,
  type ReturnFormErrors,
  type ReturnFormValues,
  type ReturnLineDraft,
  type ReturnSource,
} from "./return-form";
import { useLineScanner } from "./use-line-scanner";

export type ReturnStart = { kind: "supplier" } | { kind: "note"; noteId: string };

interface ReturnFormScreenProps {
  start: ReturnStart;
  registerLeaveGuard: (guard: LeaveGuard | null) => void;
  onBack: () => void;
  onPosted: (purchaseReturn: PurchaseReturn) => void;
  onSessionEnded: () => void;
}

const noErrors: ReturnFormErrors = { line: {} };

const SEARCH_DEBOUNCE_MS = 150;

const reasonItems = purchaseReturnReasons.map((reason) => ({
  value: reason,
  label: purchaseReturnReasonLabels[reason],
}));

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

const renderQtyNote = (line: ReturnLineDraft) => (
  <p className="m-0 text-left text-[length:var(--font-size-300)] text-secondary">
    {formatQuantity(line.returnableQtyMilli, line.unit)} left to return
  </p>
);

export function ReturnFormScreen({ start, onBack, ...rest }: ReturnFormScreenProps) {
  const [source, setSource] = useState<ReturnSource | null>(
    start.kind === "supplier" ? { kind: "supplier" } : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const noteId = start.kind === "note" ? start.noteId : null;
  const { onSessionEnded } = rest;

  useEffect(() => {
    if (noteId === null) return;
    window.vendora.purchaseReturns
      .fromNote(noteId)
      .then((result) => {
        if (result.ok) setSource({ kind: "note", note: result });
        else setLoadError(result.message);
      })
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setLoadError(serviceErrorMessage);
      });
  }, [noteId, onSessionEnded]);

  if (source) return <ReturnForm source={source} onBack={onBack} {...rest} />;
  return (
    <div className="flex flex-col items-start gap-300">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
        Purchase returns
        <Kbd>Esc</Kbd>
      </Button>
      {loadError ? (
        <ErrorLine>{loadError}</ErrorLine>
      ) : (
        <p className="m-0 text-secondary">Loading goods received note…</p>
      )}
    </div>
  );
}

interface ReturnFormProps extends Omit<ReturnFormScreenProps, "start"> {
  source: ReturnSource;
}

function ReturnForm({
  source,
  registerLeaveGuard,
  onBack,
  onPosted,
  onSessionEnded,
}: ReturnFormProps) {
  const [initial] = useState<ReturnFormValues>(() =>
    source.kind === "note" ? returnFormFromNote(source.note) : emptyReturnForm(),
  );
  const [values, setValues] = useState<ReturnFormValues>(initial);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [errors, setErrors] = useState<ReturnFormErrors>(noErrors);
  const [formError, setFormError] = useState<string | null>(null);
  const [discard, setDiscard] = useState<{ proceed: () => void } | null>(null);
  const [postPayload, setPostPayload] = useState<PostPurchaseReturnInput | null>(null);
  const [scanText, setScanText] = useState("");
  const [hasResults, setHasResults] = useState(false);
  const query = useDebouncedValue(scanText, SEARCH_DEBOUNCE_MS);

  const formRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<ProductPickerHandle | null>(null);
  const linesRef = useRef<ReturnLineDraft[]>(initial.lines);
  const supplierIdRef = useRef<string | null>(initial.supplierId);

  const isNote = source.kind === "note";
  const nothingLeft = isNote && initial.lines.length === 0;
  const dirty = isReturnFormDirty(initial, values);
  const dialogOpen = discard !== null || postPayload !== null;

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setFormError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  useEffect(() => {
    if (!isNote) {
      window.vendora.suppliers.list({ includeArchived: false }).then(setSuppliers).catch(fail);
    }
  }, [isNote, fail]);

  useEffect(() => {
    const target = isNote
      ? formRef.current?.querySelector<HTMLElement>('input[data-column="qty"]')
      : formRef.current?.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    target?.focus();
  }, [isNote]);

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

  const commitLines = useCallback((lines: ReturnLineDraft[]) => {
    linesRef.current = lines;
    setValues((current) => ({ ...current, lines }));
  }, []);

  const returnProduct = useCallback(
    async (product: OrderProduct, startQtyMilli: number): Promise<string | null> => {
      if (source.kind === "supplier" && supplierIdRef.current === null) {
        return "Pick a supplier first.";
      }
      const match = matchReturnScan(linesRef.current, source, product.id);
      if (match.kind === "not-on-note") {
        return `${product.nameEn} isn't on this goods received note.`;
      }
      let key: string;
      if (match.kind === "existing") {
        key = match.key;
      } else {
        const returnable = await window.vendora.purchaseReturns.returnable({
          supplierId: supplierIdRef.current!,
          productId: product.id,
        });
        if (!returnable.ok) return returnable.message;
        const added = addSupplierLine(linesRef.current, returnable, startQtyMilli);
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
    (lookup: BarcodeLookup) => returnProduct(lookup.product, scanQtyMilli(lookup)),
    [returnProduct],
  );

  const { notice, clearNotice, enqueue } = useLineScanner({
    enabled: !nothingLeft,
    paused: dialogOpen,
    onLookup,
    onSessionEnded,
  });

  const pickProduct = (product: OrderProduct) => {
    setScanText("");
    returnProduct(product, ONE_UNIT_MILLI).then((message) => {
      if (message) setFormError(message);
    }, fail);
  };

  const openPost = useCallback(() => {
    if (nothingLeft) return;
    const built = buildReturnPayload(source, values);
    if (!built.ok) {
      setErrors(built.errors);
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors(noErrors);
    setPostPayload(built.payload);
  }, [nothingLeft, source, values]);

  useEffect(() => {
    if (dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2" && !nothingLeft) {
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

  const setField = (patch: Partial<ReturnFormValues>) => {
    if ("supplierId" in patch) supplierIdRef.current = patch.supplierId ?? null;
    setValues((current) => ({ ...current, ...patch }));
  };

  const supplierItems = (suppliers ?? []).map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
  }));
  const supplierName =
    source.kind === "note"
      ? source.note.note.supplierName
      : (supplierItems.find((item) => item.value === values.supplierId)?.label ?? "");

  const title =
    source.kind === "note" ? `Return from ${source.note.note.grnNo}` : "Return to supplier";

  return (
    <div ref={formRef} className="flex flex-col gap-500">
      <div className="flex flex-col items-start gap-300">
        <Button type="button" variant="ghost" size="sm" onClick={() => requestLeave(onBack)}>
          <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Purchase returns
          <Kbd>Esc</Kbd>
        </Button>
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          {title}
        </h1>
      </div>
      {nothingLeft ? (
        <p className="m-0 text-secondary">Everything on this note has already been returned.</p>
      ) : (
        <>
          {formError ? <ErrorLine>{formError}</ErrorLine> : null}
          <div className="grid grid-cols-[320px_320px] items-start gap-400">
            <Field invalid={errors.supplier !== undefined}>
              <FieldLabel>Supplier</FieldLabel>
              {source.kind === "note" ? (
                <p className="m-0 min-h-[var(--height-control-md)] content-center text-[length:var(--font-size-400)] text-foreground">
                  {source.note.note.supplierName}
                  <span className="text-secondary tabular-nums">
                    {" "}
                    · invoice {source.note.note.supplierInvoiceNo}
                  </span>
                </p>
              ) : (
                <Select
                  items={supplierItems}
                  value={values.supplierId}
                  disabled={values.lines.length > 0}
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
              {source.kind === "supplier" && values.lines.length > 0 ? (
                <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                  Remove the lines to change the supplier.
                </p>
              ) : null}
              {source.kind === "supplier" && suppliers !== null && suppliers.length === 0 ? (
                <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
                  Add a supplier first, under Suppliers.
                </p>
              ) : null}
            </Field>
            <Field invalid={errors.reason !== undefined}>
              <FieldLabel>Reason</FieldLabel>
              <Select
                items={reasonItems}
                value={values.reason}
                onValueChange={(next) => {
                  if (typeof next === "string") setField({ reason: next as PurchaseReturnReason });
                }}
              >
                <SelectTrigger
                  aria-label="Return reason"
                  aria-invalid={errors.reason !== undefined}
                >
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {reasonItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.reason ? <FieldError>{errors.reason}</FieldError> : null}
            </Field>
          </div>
          <Field invalid={errors.notes !== undefined}>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              aria-label="Notes"
              aria-invalid={errors.notes !== undefined}
              autoComplete="off"
              rows={2}
              maxLength={500}
              value={values.notes}
              className={cn(controlClasses, "resize-none py-200")}
              onChange={(event) => setField({ notes: event.target.value })}
            />
            {errors.notes ? <FieldError>{errors.notes}</FieldError> : null}
          </Field>
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
            {source.kind === "supplier" ? (
              <ProductPicker
                ref={pickerRef}
                query={query}
                visible={scanText.trim() !== ""}
                onPick={pickProduct}
                onReturnToScan={focusScan}
                onResultsChange={setHasResults}
                onSessionEnded={onSessionEnded}
              />
            ) : null}
          </div>
          <OrderLines
            label="Return lines"
            lines={values.lines}
            editable
            costEditable={false}
            errors={errors.line}
            qtyNote={renderQtyNote}
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
              {formatRupees(returnTotal(values.lines))}
            </span>
            <Button type="button" onClick={openPost}>
              Post return
              <Kbd>F12</Kbd>
            </Button>
          </div>
        </>
      )}
      <PostReturnDialog
        payload={postPayload}
        summary={{
          supplierName,
          reasonLabel: values.reason ? purchaseReturnReasonLabels[values.reason] : "",
          lineCount: postPayload?.lines.length ?? 0,
          totalPaisa: returnTotal(values.lines),
        }}
        finalFocus={scanRef}
        onClose={() => setPostPayload(null)}
        onPosted={onPosted}
        onSessionEnded={onSessionEnded}
      />
      <DiscardChangesDialog
        noun="purchase return"
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
