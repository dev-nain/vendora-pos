import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { formatShiftLabel, type ReportShift } from "@shared/reports";

interface ShiftPickerProps {
  shifts: ReportShift[] | null;
  value: string | null;
  onChange: (shiftId: string | null) => void;
}

const allShifts = "all";

export function ShiftPicker({ shifts, value, onChange }: ShiftPickerProps) {
  const items = [
    { value: allShifts, label: "All shifts in period" },
    ...(shifts ?? []).map((shift) => ({ value: shift.id, label: formatShiftLabel(shift) })),
  ];
  return (
    <Select
      items={items}
      value={value ?? allShifts}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next === allShifts ? null : next);
      }}
    >
      <SelectTrigger aria-label="Shift" className="w-[340px]">
        {shifts === null ? (
          <span className="flex-1 truncate text-secondary">Loading shifts…</span>
        ) : (
          <SelectValue className="truncate" />
        )}
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
