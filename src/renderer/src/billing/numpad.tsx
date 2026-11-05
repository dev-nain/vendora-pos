import { CheckIcon, CornerDownLeftIcon, DeleteIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import type { NumpadMode } from "./numpad-entry";

interface NumpadProps {
  mode: NumpadMode | null;
  disabled: boolean;
  onKey: (key: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onMode: (mode: NumpadMode) => void;
}

const keyClasses =
  "min-h-[44px] min-w-[44px] text-[length:var(--font-size-450)] font-medium tabular-nums";

function Key({
  children,
  label,
  disabled,
  onPress,
  className,
}: {
  children: ReactNode;
  label?: string;
  disabled: boolean;
  onPress: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      aria-label={label}
      disabled={disabled}
      tabIndex={-1}
      className={cn(keyClasses, className)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </Button>
  );
}

const modeKeys: { mode: NumpadMode; label: string; keycap: string }[] = [
  { mode: "qty", label: "Qty", keycap: "F3" },
  { mode: "discount", label: "%", keycap: "F4" },
  { mode: "price", label: "Price", keycap: "F5" },
];

function ModeKey({
  mode,
  label,
  keycap,
  active,
  disabled,
  onMode,
}: {
  mode: NumpadMode;
  label: string;
  keycap: string;
  active: boolean;
  disabled: boolean;
  onMode: (mode: NumpadMode) => void;
}) {
  return (
    <Key
      label={mode === "discount" ? "Discount" : label}
      disabled={disabled}
      onPress={() => onMode(mode)}
      className={cn("px-200", active && "bg-surface-selected")}
    >
      {active ? <CheckIcon aria-hidden="true" size={14} strokeWidth={2} /> : null}
      {label}
      <Kbd>{keycap}</Kbd>
    </Key>
  );
}

export function Numpad({ mode, disabled, onKey, onBackspace, onEnter, onMode }: NumpadProps) {
  const digit = (key: string) => (
    <Key key={key} disabled={disabled} onPress={() => onKey(key)}>
      {key}
    </Key>
  );
  const modeKey = (index: number) => {
    const entry = modeKeys[index];
    if (!entry) return null;
    return <ModeKey {...entry} active={mode === entry.mode} disabled={disabled} onMode={onMode} />;
  };
  return (
    <div role="group" aria-label="Numpad" className="grid grid-cols-[repeat(3,52px)_96px] gap-200">
      {["7", "8", "9"].map(digit)}
      {modeKey(0)}
      {["4", "5", "6"].map(digit)}
      {modeKey(1)}
      {["1", "2", "3"].map(digit)}
      {modeKey(2)}
      {digit(".")}
      {digit("0")}
      <Key label="Backspace" disabled={disabled} onPress={onBackspace}>
        <DeleteIcon aria-hidden="true" size={18} strokeWidth={2} />
      </Key>
      <Key label="Enter" disabled={disabled} onPress={onEnter}>
        <CornerDownLeftIcon aria-hidden="true" size={18} strokeWidth={2} />
      </Key>
    </div>
  );
}
