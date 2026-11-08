import type { PurchaseHistoryRow } from "@shared/purchase-history";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatDate } from "@renderer/lib/date-time";
import { signedRupees } from "../billing/bill-format";
import { signedQuantityText } from "../inventory/stock-format";
import { ProductNameCell } from "../products/product-cells";

interface PurchaseHistoryTableProps {
  items: readonly PurchaseHistoryRow[];
  subject: "product" | "supplier";
  label: string;
}

const typeLabels = { receipt: "Receipt", return: "Return" } as const;

const negativeClass = (value: number): string => (value < 0 ? "text-critical" : "");

export function PurchaseHistoryTable({ items, subject, label }: PurchaseHistoryTableProps) {
  return (
    <Table className="table-fixed" aria-label={label}>
      <colgroup>
        <col className="w-[152px]" />
        <col className="w-[168px]" />
        <col className="w-[96px]" />
        <col />
        <col className="w-[120px]" />
        <col className="w-[120px]" />
        <col className="w-[132px]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Document</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>{subject === "supplier" ? "Product" : "Supplier"}</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Unit cost</TableHead>
          <TableHead className="text-right">Line total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="tabular-nums">{formatDate(row.createdAt)}</TableCell>
            <TableCell className="truncate tabular-nums text-foreground" title={row.documentNo}>
              {row.documentNo}
            </TableCell>
            <TableCell>{typeLabels[row.kind]}</TableCell>
            {subject === "supplier" ? (
              <TableCell className="py-100">
                <ProductNameCell item={row} />
              </TableCell>
            ) : (
              <TableCell className="truncate" title={row.supplierName}>
                {row.supplierName}
              </TableCell>
            )}
            <TableCell className={`text-right tabular-nums ${negativeClass(row.qtyMilli)}`}>
              {signedQuantityText(row.qtyMilli, row.unit)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {signedRupees(row.unitCostPaisa)}
            </TableCell>
            <TableCell className={`text-right tabular-nums ${negativeClass(row.lineTotalPaisa)}`}>
              {signedRupees(row.lineTotalPaisa)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
