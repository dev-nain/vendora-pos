import { useState, type ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import type { ReportCellValue } from "@shared/reports";
import {
  grossProfitByCategoryReport,
  grossProfitByProductReport,
  salesByDayReport,
  type ReportDefinition,
} from "./report-definitions";
import { ReportView } from "./report-view";

interface ReportsScreenProps {
  onSessionEnded: () => void;
}

interface ReportEntry {
  id: string;
  label: string;
  render: (picker: ReactNode, onSessionEnded: () => void) => ReactNode;
}

function reportEntry<
  Row extends Record<string, ReportCellValue>,
  Totals extends Record<string, number | null>,
>(definition: ReportDefinition<Row, Totals>): ReportEntry {
  return {
    id: definition.id,
    label: definition.label,
    render: (picker, onSessionEnded) => (
      <ReportView
        key={definition.id}
        definition={definition}
        picker={picker}
        onSessionEnded={onSessionEnded}
      />
    ),
  };
}

const reportEntries = [
  reportEntry(salesByDayReport),
  reportEntry(grossProfitByProductReport),
  reportEntry(grossProfitByCategoryReport),
];

const reportItems = reportEntries.map((report) => ({ value: report.id, label: report.label }));

export function ReportsScreen({ onSessionEnded }: ReportsScreenProps) {
  const [reportId, setReportId] = useState<string>(reportEntries[0]!.id);
  const entry = reportEntries.find((report) => report.id === reportId);
  if (!entry) return null;

  const picker = (
    <Select
      items={reportItems}
      value={reportId}
      onValueChange={(next) => {
        if (typeof next === "string") setReportId(next);
      }}
    >
      <SelectTrigger aria-label="Report" className="w-[220px]" autoFocus>
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

  return entry.render(picker, onSessionEnded);
}
