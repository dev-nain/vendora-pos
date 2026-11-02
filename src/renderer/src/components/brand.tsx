import { cn } from "@renderer/lib/utils";

export function AppMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[3px] bg-fill-brand text-[10px] leading-none font-bold text-on-brand",
        className,
      )}
    >
      V
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-[10px] whitespace-nowrap", className)}>
      <AppMark />
      Vendora
    </span>
  );
}
