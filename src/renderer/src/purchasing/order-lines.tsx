import { Trash2Icon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";

import { Button } from "@renderer/components/ui/button";
import { FieldError } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatRupees, parseRupees } from "../lib/money";
import { formatQuantity, parseQuantityMilli } from "../lib/quantity";
import { ProductNameCell } from "../products/product-cells";
import { lineTotal, type OrderLineDraft, type OrderLineErrors } from "./order-form";

type Column = "qty" | "cost";

const unitSuffix = { piece: "pcs", kg: "kg", litre: "L" } as const;

interface OrderLinesProps {
  lines: readonly OrderLineDraft[];
  editable: boolean;
  errors: Record<string, OrderLineErrors>;
  onChange: (key: string, patch: Partial<Pick<OrderLineDraft, "qtyText" | "costText">>) => void;
  onRemove: (key: string) => void;
  onReturnToScan: () => void;
}

const money = (text: string): string => {
  const parsed = parseRupees(text);
  return parsed.ok ? formatRupees(parsed.paisa) : text;
};

const quantity = (line: OrderLineDraft): string => {
  const parsed = parseQuantityMilli(line.qtyText, line.unit);
  return parsed.ok ? formatQuantity(parsed.milli, line.unit) : line.qtyText;
};

export function OrderLines({
  lines,
  editable,
  errors,
  onChange,
  onRemove,
  onReturnToScan,
}: OrderLinesProps) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const focusColumn = (column: Column, index: number) => {
    const input = bodyRef.current?.querySelectorAll<HTMLInputElement>(
      `input[data-column="${column}"]`,
    )[index];
    input?.focus();
    input?.select();
  };

  const removeAndFocus = (column: Column, index: number, key: string) => {
    flushSync(() => onRemove(key));
    const count = bodyRef.current?.querySelectorAll(`input[data-column="${column}"]`).length ?? 0;
    if (count === 0) onReturnToScan();
    else focusColumn(column, Math.min(index, count - 1));
  };

  const onFieldKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    column: Column,
    index: number,
    key: string,
  ) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onReturnToScan();
    } else if (event.key === "ArrowDown" && index < lines.length - 1) {
      event.preventDefault();
      focusColumn(column, index + 1);
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      focusColumn(column, index - 1);
    } else if (event.key === "Delete" && event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      removeAndFocus(column, index, key);
    }
  };

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-800 text-center">
        <p className="m-0 text-secondary">Scan or search to add products.</p>
      </div>
    );
  }

  return (
    <Table className="table-fixed" aria-label="Order lines">
      <colgroup>
        <col />
        <col className="w-[148px]" />
        <col className="w-[148px]" />
        <col className="w-[148px]" />
        {editable ? <col className="w-[56px]" /> : null}
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Unit cost</TableHead>
          <TableHead className="text-right">Line total</TableHead>
          {editable ? (
            <TableHead>
              <span className="sr-only">Remove</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody ref={bodyRef}>
        {lines.map((line, index) => {
          const lineErrors = errors[line.key];
          const total = lineTotal(line);
          return (
            <TableRow key={line.key} className="align-top">
              <TableCell className="py-100">
                <ProductNameCell item={line} />
              </TableCell>
              <TableCell className="px-200 py-100 text-right tabular-nums">
                {editable ? (
                  <div className="grid gap-100">
                    <div className="flex items-center gap-100">
                      <Input
                        data-column="qty"
                        aria-label={`Quantity of ${line.nameEn}`}
                        aria-invalid={lineErrors?.qty !== undefined}
                        inputMode="decimal"
                        autoComplete="off"
                        value={line.qtyText}
                        className="min-w-0 px-200 text-right tabular-nums"
                        onChange={(event) => onChange(line.key, { qtyText: event.target.value })}
                        onKeyDown={(event) => onFieldKeyDown(event, "qty", index, line.key)}
                      />
                      <span className="shrink-0 text-[length:var(--font-size-350)] text-secondary">
                        {unitSuffix[line.unit]}
                      </span>
                    </div>
                    {lineErrors?.qty ? (
                      <FieldError className="text-left">{lineErrors.qty}</FieldError>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-foreground">{quantity(line)}</span>
                )}
              </TableCell>
              <TableCell className="px-200 py-100 text-right tabular-nums">
                {editable ? (
                  <div className="grid gap-100">
                    <Input
                      data-column="cost"
                      aria-label={`Unit cost of ${line.nameEn}`}
                      aria-invalid={lineErrors?.cost !== undefined}
                      inputMode="decimal"
                      autoComplete="off"
                      value={line.costText}
                      className="min-w-0 px-200 text-right tabular-nums"
                      onChange={(event) => onChange(line.key, { costText: event.target.value })}
                      onKeyDown={(event) => onFieldKeyDown(event, "cost", index, line.key)}
                    />
                    {lineErrors?.cost ? (
                      <FieldError className="text-left">{lineErrors.cost}</FieldError>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-foreground">{money(line.costText)}</span>
                )}
              </TableCell>
              <TableCell className="px-400 py-100 text-right font-semibold tabular-nums text-foreground">
                {total === null ? <span className="text-tertiary">—</span> : formatRupees(total)}
              </TableCell>
              {editable ? (
                <TableCell className="px-100">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${line.nameEn}`}
                    className="size-[44px] px-0"
                    onClick={() => removeAndFocus("qty", index, line.key)}
                  >
                    <Trash2Icon aria-hidden="true" size={16} strokeWidth={2} />
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
