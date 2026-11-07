import { CheckIcon, PlusIcon, TruckIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Supplier } from "@shared/suppliers";
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
import { StatusBadge } from "../products/product-cells";
import { isTypingTarget } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import { SupplierDialog } from "./supplier-dialog";
import { SupplierRowMenu } from "./supplier-row-menu";

interface SuppliersScreenProps {
  onSessionEnded: () => void;
}

interface SupplierDialogState {
  supplier: Supplier | null;
  open: boolean;
}

type PendingFocus = { kind: "id"; id: string } | { kind: "index"; index: number } | null;

const dash = <span className="text-tertiary">—</span>;

function TextCell({ value, className }: { value: string | null; className?: string }) {
  return (
    <TableCell className={`truncate ${className ?? ""}`} title={value ?? undefined}>
      {value ?? dash}
    </TableCell>
  );
}

export function SuppliersScreen({ onSessionEnded }: SuppliersScreenProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dialog, setDialog] = useState<SupplierDialogState | null>(null);

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef(0);
  const pendingFocus = useRef<PendingFocus>(null);

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const load = useCallback(() => {
    const id = ++requestId.current;
    window.vendora.suppliers
      .list({ includeArchived: showArchived })
      .then((fetched) => {
        if (id !== requestId.current) return;
        setSuppliers(fetched);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        fail(cause);
      });
  }, [showArchived, fail]);

  useEffect(load, [load]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!suppliers || !target) return;
    pendingFocus.current = null;
    const index =
      target.kind === "id"
        ? suppliers.findIndex((supplier) => supplier.id === target.id)
        : Math.min(target.index, suppliers.length - 1);
    if (index < 0) {
      addRef.current?.focus();
      return;
    }
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  }, [suppliers]);

  const reload = (focus: PendingFocus) => {
    pendingFocus.current = focus;
    load();
  };

  const openDialog = useCallback(
    (supplier: Supplier | null) => setDialog({ supplier, open: true }),
    [],
  );

  const focusRow = (index: number) => {
    setActiveIndex(index);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr")[index]?.focus();
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || dialog?.open) return;
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        openDialog(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog?.open, openDialog]);

  const items = suppliers ?? [];

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
      const supplier = items[index];
      if (supplier) openDialog(supplier);
    }
  };

  const toggleArchive = async (supplier: Supplier, index: number) => {
    try {
      const outcome = supplier.isArchived
        ? await window.vendora.suppliers.restore(supplier.id)
        : await window.vendora.suppliers.archive(supplier.id);
      if (outcome.ok) {
        setError(null);
        setStatus(`${supplier.isArchived ? "Restored" : "Archived"} ${supplier.name}.`);
      } else {
        setStatus(null);
        setError(outcome.message);
      }
      if (outcome.ok || outcome.reason === "not-found") {
        reload(showArchived ? { kind: "id", id: supplier.id } : { kind: "index", index });
      }
    } catch (cause) {
      fail(cause);
    }
  };

  const showEmpty = suppliers !== null && items.length === 0;

  return (
    <div className="flex flex-col gap-500">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Suppliers
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Keep the people and companies you buy stock from.
        </p>
      </div>
      <div className="flex items-center justify-end gap-300">
        <Button
          variant="secondary"
          aria-pressed={showArchived}
          onClick={() => {
            setShowArchived((current) => !current);
            setActiveIndex(0);
          }}
        >
          {showArchived ? <CheckIcon aria-hidden="true" size={16} strokeWidth={2} /> : null}
          Show archived
        </Button>
        <Button ref={addRef} autoFocus onClick={() => openDialog(null)}>
          <PlusIcon aria-hidden="true" size={16} strokeWidth={2} />
          Add supplier
          <Kbd>N</Kbd>
        </Button>
      </div>
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={() => reload(null)}>
            Try again
          </Button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="m-0 text-secondary empty:hidden">
        {status}
      </p>
      {suppliers === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading suppliers…</p>
        )
      ) : showEmpty ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <TruckIcon aria-hidden="true" size={24} strokeWidth={2} className="text-icon-muted" />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            No suppliers to show
          </p>
          <p className="m-0 text-secondary">Add a supplier, or turn on Show archived.</p>
        </div>
      ) : (
        <Table className="table-fixed" aria-label="Suppliers">
          <colgroup>
            <col />
            <col className="w-[200px]" />
            <col className="w-[168px]" />
            <col className="w-[120px]" />
            <col className="w-[112px]" />
            <col className="w-[64px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact person</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>NTN</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {items.map((supplier, index) => (
              <TableRow
                key={supplier.id}
                tabIndex={index === activeIndex ? 0 : -1}
                aria-selected={index === activeIndex}
                className="outline-none focus-visible:shadow-focus"
                onFocus={() => setActiveIndex(index)}
                onClick={() => setActiveIndex(index)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
              >
                <TextCell value={supplier.name} className="font-semibold text-foreground" />
                <TextCell value={supplier.contactPerson} />
                <TextCell value={supplier.phone} className="tabular-nums" />
                <TextCell value={supplier.ntn} className="tabular-nums" />
                <TableCell>
                  <StatusBadge isActive={!supplier.isArchived} />
                </TableCell>
                <TableCell className="px-200">
                  <SupplierRowMenu
                    supplier={supplier}
                    onEdit={() => openDialog(supplier)}
                    onToggleArchive={() => void toggleArchive(supplier, index)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {dialog ? (
        <SupplierDialog
          supplier={dialog.supplier}
          open={dialog.open}
          onOpenChange={(open) => setDialog((current) => (current ? { ...current, open } : null))}
          onSaved={(saved, mode) => {
            setError(null);
            setStatus(`${mode === "added" ? "Added" : "Saved"} ${saved.name}.`);
            reload({ kind: "id", id: saved.id });
          }}
          onStale={() => reload(null)}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}
