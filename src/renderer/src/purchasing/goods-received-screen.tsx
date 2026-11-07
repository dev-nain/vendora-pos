import { ChevronLeftIcon, ChevronRightIcon, PackageCheckIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { GoodsReceivedListResult } from "@shared/goods-received";
import type { Supplier } from "@shared/suppliers";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatDate } from "@renderer/lib/date-time";
import { formatRupees } from "@renderer/lib/money";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { PRODUCT_PAGE_SIZE, pageRangeLabel } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { GrnDetail } from "./grn-detail";

const ALL = "all";

type View = { kind: "list" } | { kind: "note"; id: string; status: string | null };

interface GoodsReceivedScreenProps {
  onSessionEnded: () => void;
}

export function GoodsReceivedScreen({ onSessionEnded }: GoodsReceivedScreenProps) {
  const [view, setView] = useState<View>({ kind: "list" });
  const backToList = useCallback(() => setView({ kind: "list" }), []);

  return view.kind === "list" ? (
    <NoteList
      onSessionEnded={onSessionEnded}
      onOpen={(id) => setView({ kind: "note", id, status: null })}
    />
  ) : (
    <GrnDetail
      id={view.id}
      status={view.status}
      onBack={backToList}
      onSessionEnded={onSessionEnded}
    />
  );
}

interface NoteListProps {
  onSessionEnded: () => void;
  onOpen: (id: string) => void;
}

function NoteList({ onSessionEnded, onOpen }: NoteListProps) {
  const [result, setResult] = useState<GoodsReceivedListResult | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const requestId = useRef(0);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) onSessionEnded();
      else setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.goodsReceived
      .list({
        ...(supplierId ? { supplierId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        limit: PRODUCT_PAGE_SIZE,
        offset: page * PRODUCT_PAGE_SIZE,
      })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setResult(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id === requestId.current) fail(cause);
      });
  }, [supplierId, from, to, page, fail]);

  useEffect(load, [load]);

  useEffect(() => {
    window.vendora.suppliers.list({ includeArchived: true }).then(setSuppliers).catch(fail);
  }, [fail]);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  const focusRow = (index: number) => {
    setActiveIndex(index);
    const row = bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index];
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    const last = items.length - 1;
    const target =
      event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target !== null) {
      event.preventDefault();
      focusRow(target);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const note = items[index];
      if (note) onOpen(note.id);
    }
  };

  const changeFilter = (apply: () => void) => {
    apply();
    setPage(0);
    setActiveIndex(0);
  };

  const supplierItems = [
    { value: ALL, label: "All suppliers" },
    ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
  ];

  const filtering = supplierId !== null || from !== "" || to !== "";
  const empty = filtering
    ? { title: "No goods received notes match", text: "Try another supplier or date range." }
    : {
        title: "No goods received yet",
        text: "Receive a delivery to record it and update stock.",
      };

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Goods received
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Deliveries recorded against stock.
        </p>
      </div>
      <div className="flex items-end justify-between gap-300">
        <div className="flex items-end gap-300">
          <Field className="gap-100">
            <FieldLabel>Supplier</FieldLabel>
            <Select
              items={supplierItems}
              value={supplierId ?? ALL}
              onValueChange={(next) => {
                if (typeof next === "string") {
                  changeFilter(() => setSupplierId(next === ALL ? null : next));
                }
              }}
            >
              <SelectTrigger aria-label="Supplier" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supplierItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="gap-100">
            <FieldLabel>From</FieldLabel>
            <Input
              type="date"
              aria-label="From date"
              value={from}
              className="w-[160px]"
              onChange={(event) => changeFilter(() => setFrom(event.target.value))}
            />
          </Field>
          <Field className="gap-100">
            <FieldLabel>To</FieldLabel>
            <Input
              type="date"
              aria-label="To date"
              value={to}
              className="w-[160px]"
              onChange={(event) => changeFilter(() => setTo(event.target.value))}
            />
          </Field>
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
      {result === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading goods received notes…</p>
        )
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <PackageCheckIcon
            aria-hidden="true"
            size={24}
            strokeWidth={2}
            className="text-icon-muted"
          />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            {empty.title}
          </p>
          <p className="m-0 text-secondary">{empty.text}</p>
        </div>
      ) : (
        <Table className="table-fixed" aria-label="Goods received notes">
          <colgroup>
            <col className="w-[168px]" />
            <col />
            <col className="w-[148px]" />
            <col className="w-[148px]" />
            <col className="w-[124px]" />
            <col className="w-[64px]" />
            <col className="w-[132px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>GRN</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((note, index) => (
              <TableRow
                key={note.id}
                tabIndex={index === activeIndex ? 0 : -1}
                aria-selected={index === activeIndex}
                className="cursor-pointer outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => onOpen(note.id)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TableCell className="font-semibold tabular-nums text-foreground">
                  {note.grnNo}
                </TableCell>
                <TableCell className="truncate" title={note.supplierName}>
                  {note.supplierName}
                </TableCell>
                <TableCell className="truncate tabular-nums" title={note.supplierInvoiceNo}>
                  {note.supplierInvoiceNo}
                </TableCell>
                <TableCell className="tabular-nums">
                  {note.orderNo ?? <span className="text-tertiary">Direct</span>}
                </TableCell>
                <TableCell className="tabular-nums">{formatDate(note.createdAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{note.lineCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupees(note.totalPaisa)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {total > PRODUCT_PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums">
            {pageRangeLabel(page, items.length, total)}
          </p>
          <div className="flex items-center gap-200">
            <Button
              variant="secondary"
              disabled={page === 0}
              focusableWhenDisabled
              onClick={() => {
                setPage(page - 1);
                setActiveIndex(0);
              }}
            >
              <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={(page + 1) * PRODUCT_PAGE_SIZE >= total}
              focusableWhenDisabled
              onClick={() => {
                setPage(page + 1);
                setActiveIndex(0);
              }}
            >
              Next
              <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
