import type { ComponentProps } from "react";

import { cn } from "@renderer/lib/utils";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-100 border border-strong bg-surface-secondary px-[6px] font-mono text-[length:var(--font-size-300)] leading-none font-medium text-secondary",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
