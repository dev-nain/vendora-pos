import { TriangleAlertIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import type { LowMarginItem } from "@shared/goods-received";
import { productMessages, priceUpdateInput, updateProductInputSchema } from "@shared/products";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Field, FieldError } from "@renderer/components/ui/field";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { AdornedInput } from "../products/barcode-rows";
import { formatMarginBps, initialRows, plannedChanges, type MarginRow } from "./margin-prompt";

interface MarginPromptDialogProps {
  noteId: string;
  finalFocus: RefObject<HTMLElement | null>;
  onDone: (updated: number) => void;
  onSessionEnded: () => void;
}

type Loaded = { thresholdBps: number; rows: MarginRow[] };

const productCount = (count: number) => `${count} ${count === 1 ? "product is" : "products are"}`;

function MarginCell({ item }: { item: LowMarginItem }) {
  return (
    <span className="inline-flex items-center justify-end gap-100 text-warning">
      <TriangleAlertIcon
        aria-hidden="true"
        size={14}
        strokeWidth={2}
        className="shrink-0 text-icon-warning"
      />
      {formatMarginBps(item.marginBps)}
      {item.salePricePaisa === 0 ? <span className="sr-only">no sale price</span> : null}
    </span>
  );
}

export function MarginPromptDialog({
  noteId,
  finalFocus,
  onDone,
  onSessionEnded,
}: MarginPromptDialogProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const focusId = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const updatedRef = useRef(0);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const updateButton = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.vendora.goodsReceived
      .lowMargin(noteId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.thresholdBps !== null && result.items.length > 0) {
          setLoaded({ thresholdBps: result.thresholdBps, rows: initialRows(result.items) });
        } else onDone(0);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (isSessionError(cause)) onSessionEnded();
        else onDone(0);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, onDone, onSessionEnded]);

  useEffect(() => {
    if (focusId.current === null) return;
    inputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  });

  const rows = loaded?.rows ?? [];

  const submit = async () => {
    if (pendingRef.current || !loaded) return;
    const { changes, errors: parseErrors } = plannedChanges(loaded.rows);
    if (Object.keys(parseErrors).length > 0) {
      setErrors(parseErrors);
      focusId.current =
        loaded.rows.find((row) => parseErrors[row.item.productId])?.item.productId ?? null;
      return;
    }
    if (changes.length === 0) {
      setOpen(false);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setErrors({});
    const failures: Record<string, string> = {};
    const updated = new Set<string>();
    try {
      for (const change of changes) {
        try {
          const current = await window.vendora.products.get(change.productId);
          if (!current.ok) {
            failures[change.productId] = current.message;
            continue;
          }
          const parsed = updateProductInputSchema.safeParse(
            priceUpdateInput(current.product, change.salePricePaisa),
          );
          if (!parsed.success) {
            failures[change.productId] = parsed.error.issues.some(
              (issue) => issue.path[0] === "mrpPaisa",
            )
              ? productMessages.mrpBelowSalePrice
              : serviceErrorMessage;
            continue;
          }
          const result = await window.vendora.products.update(parsed.data);
          if (result.ok) updated.add(change.productId);
          else failures[change.productId] = result.message;
        } catch (cause) {
          if (isSessionError(cause)) {
            onSessionEnded();
            return;
          }
          failures[change.productId] = serviceErrorMessage;
        }
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }

    updatedRef.current += updated.size;
    const remaining = loaded.rows.filter((row) => !updated.has(row.item.productId));
    const failedFirst = remaining.find((row) => failures[row.item.productId]);
    if (failedFirst) {
      setLoaded({ ...loaded, rows: remaining });
      setErrors(failures);
      focusId.current = failedFirst.item.productId;
      return;
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open || !loaded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const skip = () => setOpen(false);

  const onPriceKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== "Enter" || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const next = rows[index + 1];
    if (next) inputs.current.get(next.item.productId)?.focus();
    else updateButton.current?.focus();
  };

  const setPrice = (productId: string, newPrice: string) => {
    if (!loaded) return;
    setLoaded({
      ...loaded,
      rows: loaded.rows.map((row) =>
        row.item.productId === productId ? { ...row, newPrice } : row,
      ),
    });
    if (errors[productId]) setErrors({ ...errors, [productId]: "" });
  };

  if (!loaded) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : skip())}
      onOpenChangeComplete={(next) => {
        if (!next) onDone(updatedRef.current);
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        initialFocus={firstInput}
        className="grid max-h-[calc(100vh-64px)] w-[min(880px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <DialogHeader className="gap-200">
          <DialogTitle>
            {productCount(rows.length)} below your {formatMarginBps(loaded.thresholdBps)} margin
          </DialogTitle>
          <DialogDescription className="text-[length:var(--font-size-350)] text-secondary">
            Margin is (sale price without sales tax − average cost) ÷ sale price without sales tax.
            Change a price to update it, or skip to keep prices as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-600 pb-400">
          <Table className="table-fixed" aria-label="Products below the margin">
            <colgroup>
              <col />
              <col className="w-[112px]" />
              <col className="w-[112px]" />
              <col className="w-[104px]" />
              <col className="w-[176px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="px-300">Product</TableHead>
                <TableHead className="px-300 text-right">Average cost</TableHead>
                <TableHead className="px-300 text-right">Sale price</TableHead>
                <TableHead className="px-300 text-right">Margin</TableHead>
                <TableHead className="px-300 text-right">New price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => {
                const { item } = row;
                const error = errors[item.productId];
                return (
                  <TableRow key={item.productId}>
                    <TableCell className="px-300 align-middle">
                      <span
                        className="block truncate font-semibold text-foreground"
                        title={item.nameEn}
                      >
                        {item.nameEn}
                      </span>
                      {item.nameUr ? (
                        <span
                          lang="ur"
                          dir="rtl"
                          className="block truncate font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
                        >
                          {item.nameUr}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-300 text-right tabular-nums">
                      {formatRupees(item.costPaisa)}
                    </TableCell>
                    <TableCell className="px-300 text-right tabular-nums">
                      {formatRupees(item.salePricePaisa)}
                    </TableCell>
                    <TableCell className="px-300 text-right tabular-nums">
                      <MarginCell item={item} />
                    </TableCell>
                    <TableCell className="px-300 py-100">
                      <Field invalid={Boolean(error)} className="justify-items-end gap-100">
                        <AdornedInput
                          name="newPrice"
                          ref={(element) => {
                            if (element) inputs.current.set(item.productId, element);
                            else inputs.current.delete(item.productId);
                            if (index === 0) firstInput.current = element;
                          }}
                          aria-label={`New price for ${item.nameEn}`}
                          aria-invalid={Boolean(error)}
                          inputMode="decimal"
                          autoComplete="off"
                          maxLength={16}
                          lead="Rs"
                          className="h-[var(--height-control-md)] w-[140px] text-right tabular-nums"
                          value={row.newPrice}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => setPrice(item.productId, event.target.value)}
                          onKeyDown={(event) => onPriceKeyDown(event, index)}
                        />
                        {error ? <FieldError>{error}</FieldError> : null}
                      </Field>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={skip}>
            Skip
            <Kbd>Esc</Kbd>
          </Button>
          <Button ref={updateButton} type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? "Updating…" : "Update prices"}
            <Kbd>Ctrl+Enter</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
