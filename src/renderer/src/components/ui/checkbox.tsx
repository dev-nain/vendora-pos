import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";

import { cn } from "@renderer/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group inline-flex size-[44px] shrink-0 touch-manipulation items-center justify-center bg-transparent p-0 outline-none select-none disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-[20px] items-center justify-center rounded-100 border border-strong bg-surface-secondary text-on-brand transition-[background-color,border-color,box-shadow] duration-[var(--duration-100)] ease-[var(--ease-out)] group-hover:border-line-hover group-focus-visible:shadow-focus group-data-[checked]:border-transparent group-data-[checked]:bg-fill-brand group-data-[checked]:group-hover:bg-fill-brand-hover group-data-[indeterminate]:border-transparent group-data-[indeterminate]:bg-fill-brand group-data-[indeterminate]:group-hover:bg-fill-brand-hover group-data-[disabled]:border-transparent group-data-[disabled]:bg-[var(--color-bg-fill-brand-disabled)] group-data-[disabled]:text-disabled"
      >
        <CheckboxPrimitive.Indicator
          render={(indicatorProps, state) => (
            <span {...indicatorProps} className="inline-flex">
              {state.indeterminate ? (
                <MinusIcon size={14} strokeWidth={3} />
              ) : (
                <CheckIcon size={14} strokeWidth={3} />
              )}
            </span>
          )}
        />
      </span>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
