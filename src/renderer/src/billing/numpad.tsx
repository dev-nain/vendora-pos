import { CheckIcon, CornerDownLeftIcon, DeleteIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import type { NumpadMode } from "./numpad-entry";

interface NumpadProps {
  mode?: NumpadMode | null;
  disabled: boolean;
  onKey: (key: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onMode?: (mode: NumpadMode) => void;
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

const modeKeys: { mode: NumpadMode; label: string }[] = [
  { mode: "qty", label: "Qty" },
  { mode: "discount", label: "%" },
  { mode: "price", label: "Price" },
];

function ModeKey({
  mode,
  label,
  active,
  disabled,
  onMode,
}: {
  mode: NumpadMode;
  label: string;
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
    </Key>
  );
}

export function Numpad({
  mode = null,
  disabled,
  onKey,
  onBackspace,
  onEnter,
  onMode,
}: NumpadProps) {
  const digit = (key: string) => (
    <Key key={key} disabled={disabled} onPress={() => onKey(key)}>
      {key}
    </Key>
  );
  const modeKey = (index: number) => {
    const entry = modeKeys[index];
    if (!entry || !onMode) return null;
    return <ModeKey {...entry} active={mode === entry.mode} disabled={disabled} onMode={onMode} />;
  };
  const backspaceKey = (
    <Key
      label="Backspace"
      disabled={disabled}
      onPress={onBackspace}
      className={onMode ? "" : "row-span-2"}
    >
      <DeleteIcon aria-hidden="true" size={18} strokeWidth={2} />
    </Key>
  );
  const enterKey = (
    <Key label="Enter" disabled={disabled} onPress={onEnter} className={onMode ? "" : "row-span-2"}>
      <CornerDownLeftIcon aria-hidden="true" size={18} strokeWidth={2} />
    </Key>
  );
  if (!onMode) {
    return (
      <div
        role="group"
        aria-label="Numpad"
        className="grid grid-cols-[repeat(3,52px)_96px] gap-200"
      >
        {["7", "8", "9"].map(digit)}
        {backspaceKey}
        {["4", "5", "6"].map(digit)}
        {["1", "2", "3"].map(digit)}
        {enterKey}
        {digit(".")}
        {digit("0")}
        <span aria-hidden="true" />
      </div>
    );
  }
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
      {backspaceKey}
      {enterKey}
    </div>
  );
}
