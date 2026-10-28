import type { ComponentProps } from "react";

import { cn } from "@renderer/lib/utils";

function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-[length:var(--font-size-350)] font-medium text-foreground data-disabled:text-disabled peer-disabled:text-disabled",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
