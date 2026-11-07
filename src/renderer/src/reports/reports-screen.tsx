import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { reportDefinitions } from "./report-definitions";
import { ReportView } from "./report-view";

interface ReportsScreenProps {
  onSessionEnded: () => void;
}

const reportItems = reportDefinitions.map((report) => ({ value: report.id, label: report.label }));

export function ReportsScreen({ onSessionEnded }: ReportsScreenProps) {
  const [reportId, setReportId] = useState<string>(reportDefinitions[0].id);
  const definition = reportDefinitions.find((report) => report.id === reportId);
  if (!definition) return null;

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

  return (
    <ReportView
      key={definition.id}
      definition={definition}
      picker={picker}
      onSessionEnded={onSessionEnded}
    />
  );
}
