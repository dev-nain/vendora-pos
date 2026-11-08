import { useEffect, useRef } from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { reportPresetLabels, reportPresets, type ReportPreset } from "@shared/reports";
import { ErrorLine } from "../users/form-parts";

interface DateRangeControlProps {
  preset: ReportPreset;
  from: string;
  to: string;
  error: string | null;
  onPreset: (preset: ReportPreset) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export function DateRangeControl({
  preset,
  from,
  to,
  error,
  onPreset,
  onFromChange,
  onToChange,
}: DateRangeControlProps) {
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preset === "custom") startRef.current?.focus();
  }, [preset]);

  return (
    <>
      <div role="group" aria-label="Period" className="flex items-center gap-200">
        {reportPresets.map((value) => (
          <Button
            key={value}
            variant={preset === value ? "default" : "secondary"}
            aria-pressed={preset === value}
            onClick={() => onPreset(value)}
          >
            {reportPresetLabels[value]}
          </Button>
        ))}
      </div>
      {preset === "custom" ? (
        <div className="flex basis-full flex-wrap items-center gap-300">
          <Input
            ref={startRef}
            type="date"
            aria-label="Start date"
            aria-invalid={error !== null}
            value={from}
            className="w-[160px]"
            onChange={(event) => onFromChange(event.target.value)}
          />
          <Input
            type="date"
            aria-label="End date"
            aria-invalid={error !== null}
            value={to}
            className="w-[160px]"
            onChange={(event) => onToChange(event.target.value)}
          />
          {error ? <ErrorLine>{error}</ErrorLine> : null}
        </div>
      ) : null}
    </>
  );
}
