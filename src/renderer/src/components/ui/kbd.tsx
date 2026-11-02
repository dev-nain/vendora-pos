import type { ComponentProps } from "react";

import { cn } from "@renderer/lib/utils";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[3px] border border-b-2 border-strong bg-fill-secondary px-[5px] font-sans text-[11px] leading-none font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
