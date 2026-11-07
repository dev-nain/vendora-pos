import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import type { ReportRange } from "@shared/reports";
import type { PostedStocktakesResult } from "@shared/stock-reports";
import { isSessionError } from "../auth/messages";
import { formatDateTime } from "../lib/date-time";

const ALL_COUNTS = "all";

interface ReportStocktakeSelectProps {
  range: ReportRange | null;
  stocktakeId: string | null;
  onChange: (stocktakeId: string | null) => void;
  onSessionEnded: () => void;
}

export function ReportStocktakeSelect({
  range,
  stocktakeId,
  onChange,
  onSessionEnded,
}: ReportStocktakeSelectProps) {
  const [loaded, setLoaded] = useState<{
    range: string;
    items: PostedStocktakesResult["items"];
  } | null>(null);
  const rangeKey = range ? `${range.from}:${range.to}` : null;

  useEffect(() => {
    if (!range || !rangeKey) return;
    let current = true;
    window.vendora.reports
      .postedStocktakes(range)
      .then((result) => {
        if (!current) return;
        setLoaded({ range: rangeKey, items: result.items });
        if (stocktakeId !== null && !result.items.some((item) => item.id === stocktakeId)) {
          onChange(null);
        }
      })
      .catch((cause: unknown) => {
        if (current && isSessionError(cause)) onSessionEnded();
      });
    return () => {
      current = false;
    };
  }, [range, rangeKey, stocktakeId, onChange, onSessionEnded]);

  const items = loaded?.range === rangeKey ? loaded.items : [];
  const options = [
    { value: ALL_COUNTS, label: "All counts" },
    ...items.map((item) => ({
      value: item.id,
      label: `${formatDateTime(item.postedAt)} · ${item.label}`,
    })),
  ];
  const value =
    stocktakeId !== null && items.some((item) => item.id === stocktakeId)
      ? stocktakeId
      : ALL_COUNTS;

  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next === ALL_COUNTS ? null : next);
      }}
    >
      <SelectTrigger aria-label="Count" className="w-[280px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
