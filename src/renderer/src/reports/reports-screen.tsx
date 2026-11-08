import { useState } from "react";

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
  reportDefinitions,
  salesByDayReport,
  salesTaxSummaryReport,
} from "./report-definitions";
import { ReportView } from "./report-view";

interface ReportsScreenProps {
  onSessionEnded: () => void;
  onOpenSale?: ((invoiceNo: string) => void) | undefined;
}

const reportItems = reportDefinitions.map((report) => ({ value: report.id, label: report.label }));

export function ReportsScreen({ onSessionEnded, onOpenSale }: ReportsScreenProps) {
  const [reportId, setReportId] = useState<string>(reportDefinitions[0].id);

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

  if (reportId === discountsReturnsVoidsReport.id) {
    return (
      <ReportView
        key={reportId}
        definition={discountsReturnsVoidsReport}
        picker={picker}
        onSessionEnded={onSessionEnded}
        onOpenSale={onOpenSale}
      />
    );
  }
  if (reportId === grossProfitByProductReport.id) {
    return (
      <ReportView
        key={reportId}
        definition={grossProfitByProductReport}
        picker={picker}
        onSessionEnded={onSessionEnded}
      />
    );
  }
  if (reportId === grossProfitByCategoryReport.id) {
    return (
      <ReportView
        key={reportId}
        definition={grossProfitByCategoryReport}
        picker={picker}
        onSessionEnded={onSessionEnded}
      />
    );
  }
  if (reportId === salesTaxSummaryReport.id) {
    return (
      <ReportView
        key={reportId}
        definition={salesTaxSummaryReport}
        picker={picker}
        onSessionEnded={onSessionEnded}
      />
    );
  }
  return (
    <ReportView
      key={reportId}
      definition={salesByDayReport}
      picker={picker}
      onSessionEnded={onSessionEnded}
    />
  );
}
