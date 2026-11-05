import { AlertCircleIcon, ArrowLeftIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { returnMessages, type ReturnableResult } from "@shared/returns";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
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
import { formatDateTime } from "../lib/date-time";
import { formatRupees } from "../lib/money";
import {
  buildReturnLines,
  canRefund,
  isWholeOnly,
  returnQuantityText,
  rowError,
} from "./return-picker";

type Loaded = Extract<ReturnableResult, { ok: true }>;

interface ReturnPanelProps {
  saleId: string;
  onBack: () => void;
  onReturned: () => void;
  onSessionEnded: () => void;
}

const inputId = (saleLineId: string) => `return-qty-${saleLineId}`;

export function ReturnPanel({ saleId, onBack, onReturned, onSessionEnded }: ReturnPanelProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    window.vendora.returns
      .returnable(saleId)
      .then((found) => {
        if (!live) return;
        if (found.ok) setLoaded(found);
        else setFailure(found.message);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        if (isSessionError(cause)) onSessionEnded();
        else setFailure(serviceErrorMessage);
      });
    return () => {
      live = false;
    };
  }, [saleId, onSessionEnded]);

  const lines = loaded?.lines ?? [];
  const enabled = lines.filter((line) => line.leftQtyMilli > 0);
  const firstEnabledId = enabled[0]?.saleLineId;
  const ready = canRefund(lines, texts);

  useEffect(() => {
    if (firstEnabledId) document.getElementById(inputId(firstEnabledId))?.focus();
  }, [firstEnabledId]);

  const refund = () => {
    if (!loaded || running.current || !ready) return;
    running.current = true;
    setBusy(true);
    setRefusal(null);
    window.vendora.returns
      .addFromSale({ saleId, lines: buildReturnLines(lines, texts) })
      .then((outcome) => {
        if (outcome.ok) onReturned();
        else setRefusal(outcome.message);
      })
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setRefusal(serviceErrorMessage);
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    if (event.key === "Enter") {
      event.preventDefault();
      refund();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const ids = enabled.map((line) => inputId(line.saleLineId));
      const index = ids.indexOf(target.id);
      const next =
        ids[Math.min(ids.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) document.getElementById(next)?.focus();
    }
  };

  if (failure) {
    return (
      <div className="grid content-start justify-items-start gap-200 p-600">
        <p role="alert" className="m-0 text-secondary">
          {failure}
        </p>
        <Button variant="secondary" onClick={onBack}>
          Back
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    );
  }
  if (!loaded) return <p className="m-0 p-600 text-secondary">Loading…</p>;

  return (
    <section
      aria-label="Return items"
      className="flex min-h-0 flex-1 flex-col gap-400 p-600"
      onKeyDown={onKeyDown}
    >
      <div className="grid gap-050">
        <h2 className="m-0 text-[length:var(--font-size-550)] font-semibold text-foreground tabular-nums">
          Return from {loaded.sale.invoiceNo}
        </h2>
        <p className="m-0 text-[length:var(--font-size-300)] text-tertiary">
          {formatDateTime(loaded.sale.createdAt)} · {loaded.sale.cashierName}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table aria-label="Lines to return" className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-[112px] text-right">Price</TableHead>
              <TableHead className="w-[112px] text-right">Sold</TableHead>
              <TableHead className="w-[112px] text-right">Refunded</TableHead>
              <TableHead className="w-[112px] text-right">Left</TableHead>
              <TableHead className="w-[152px] text-right">Return</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const error = rowError(texts[line.saleLineId] ?? "", line);
              const suffix = isWholeOnly(line) ? null : line.unit === "litre" ? "L" : "kg";
              return (
                <TableRow key={line.saleLineId}>
                  <TableCell className="h-auto min-h-[var(--height-row)] py-200">
                    <div className="grid gap-050">
                      <span className="text-foreground">{line.nameEn}</span>
                      {line.nameUr ? (
                        <span
                          dir="rtl"
                          lang="ur"
                          className="text-right font-urdu leading-[var(--line-height-urdu)] text-secondary"
                        >
                          {line.nameUr}
                        </span>
                      ) : null}
                      {line.pendingQtyMilli > 0 ? (
                        <span className="text-[length:var(--font-size-300)] text-tertiary">
                          {returnQuantityText(line.pendingQtyMilli, line)} on this bill
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupees(line.unitPricePaisa)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {returnQuantityText(line.soldQtyMilli, line)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {returnQuantityText(line.refundedQtyMilli, line)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {returnQuantityText(line.leftQtyMilli, line)}
                  </TableCell>
                  <TableCell className="py-100">
                    <div className="grid justify-items-end gap-050">
                      <div className="flex items-center gap-100">
                        <Input
                          id={inputId(line.saleLineId)}
                          inputMode={isWholeOnly(line) ? "numeric" : "decimal"}
                          autoComplete="off"
                          aria-label={`Return quantity, ${line.nameEn}`}
                          aria-invalid={error ? true : undefined}
                          disabled={line.leftQtyMilli === 0}
                          value={texts[line.saleLineId] ?? ""}
                          className="w-[120px] text-right tabular-nums"
                          onChange={(event) => {
                            const value = event.target.value;
                            setRefusal(null);
                            setTexts((current) => ({ ...current, [line.saleLineId]: value }));
                          }}
                        />
                        {suffix ? (
                          <span className="text-[length:var(--font-size-300)] text-tertiary">
                            {suffix}
                          </span>
                        ) : null}
                      </div>
                      {error ? (
                        <p
                          role="alert"
                          className="m-0 flex items-center gap-100 text-[length:var(--font-size-300)] text-critical"
                        >
                          <AlertCircleIcon
                            aria-hidden="true"
                            size={14}
                            strokeWidth={2}
                            className="shrink-0 text-[var(--color-icon-critical)]"
                          />
                          {error}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {loaded.hasReturnLines ? (
          <p className="m-0 mt-200 text-[length:var(--font-size-300)] text-tertiary">
            {returnMessages.notReturnable}
          </p>
        ) : null}
      </div>
      {refusal ? (
        <p role="alert" className="m-0 flex items-center gap-200 text-critical">
          <AlertCircleIcon
            aria-hidden="true"
            size={16}
            strokeWidth={2}
            className="shrink-0 text-[var(--color-icon-critical)]"
          />
          {refusal}
        </p>
      ) : null}
      <div className="flex justify-end gap-400">
        <Button variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back
          <Kbd>Esc</Kbd>
        </Button>
        <Button size="lg" disabled={!ready || busy} onClick={refund}>
          Refund
          <Kbd>Enter</Kbd>
        </Button>
      </div>
    </section>
  );
}
