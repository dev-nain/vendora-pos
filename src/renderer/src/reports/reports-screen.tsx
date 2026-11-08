import { useState, type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  discountsReturnsVoidsReport,
  grossProfitByCategoryReport,
  grossProfitByProductReport,
  lowStockReport,
  negativeStockReport,
  paymentMethodReport,
  purchasesBySupplierReport,
  salesByCashierReport,
  salesByCategoryReport,
  salesByDayReport,
  salesByHourReport,
  salesByProductReport,
  salesTaxSummaryReport,
  stockMovementsReport,
  stockOnHandReport,
  stocktakeVarianceReport,
  type ReportDefinition,
} from "./report-definitions";
import { ReportView } from "./report-view";

interface ReportsScreenProps {
  onSessionEnded: () => void;
  onOpenSale?: ((invoiceNo: string) => void) | undefined;
}

interface ReportViewContext {
  picker: ReactNode;
  onSessionEnded: () => void;
  onOpenSale: ((invoiceNo: string) => void) | undefined;
}

interface ReportEntry {
  id: string;
  label: string;
  render: (context: ReportViewContext) => ReactNode;
}

function reportEntry<Result>(definition: ReportDefinition<Result>): ReportEntry {
  return {
    id: definition.id,
    label: definition.label,
    render: ({ picker, onSessionEnded, onOpenSale }) => (
      <ReportView
        key={definition.id}
        definition={definition}
        picker={picker}
        onSessionEnded={onSessionEnded}
        onOpenSale={onOpenSale}
      />
    ),
  };
}

const entries: readonly [ReportEntry, ...ReportEntry[]] = [
  reportEntry(salesByDayReport),
  reportEntry(salesByHourReport),
  reportEntry(salesByProductReport),
  reportEntry(salesByCategoryReport),
  reportEntry(salesByCashierReport),
  reportEntry(paymentMethodReport),
  reportEntry(grossProfitByProductReport),
  reportEntry(grossProfitByCategoryReport),
  reportEntry(salesTaxSummaryReport),
  reportEntry(discountsReturnsVoidsReport),
  reportEntry(stockOnHandReport),
  reportEntry(lowStockReport),
  reportEntry(negativeStockReport),
  reportEntry(stockMovementsReport),
  reportEntry(purchasesBySupplierReport),
  reportEntry(stocktakeVarianceReport),
];

const reportItems = entries.map((report) => ({ value: report.id, label: report.label }));

export function ReportsScreen({ onSessionEnded, onOpenSale }: ReportsScreenProps) {
  const [reportId, setReportId] = useState<string>(entries[0].id);
  const entry = entries.find((report) => report.id === reportId) ?? entries[0];

  const picker = (
    <Select
      items={reportItems}
      value={reportId}
      onValueChange={(next) => {
        if (typeof next === "string") setReportId(next);
      }}
    >
      <SelectTrigger aria-label="Report" className="w-[280px]" autoFocus>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {reportItems.map((report) => (
          <SelectItem key={report.value} value={report.value}>
            {report.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return entry.render({ picker, onSessionEnded, onOpenSale });
}
