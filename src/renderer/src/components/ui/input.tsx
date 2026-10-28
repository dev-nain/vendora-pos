import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@renderer/lib/utils";

const controlClasses =
  "w-full min-h-[var(--height-control-md)] rounded-200 border border-input bg-surface px-300 text-[length:var(--font-size-400)] text-foreground shadow-100 outline-none transition-[border-color,box-shadow] duration-[var(--duration-100)] ease-[var(--ease-out)] hover:border-line-hover focus-visible:border-focus focus-visible:shadow-focus aria-invalid:border-line-critical data-invalid:border-line-critical disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-secondary disabled:text-disabled disabled:shadow-none data-disabled:cursor-not-allowed data-disabled:border-line data-disabled:bg-surface-secondary data-disabled:text-disabled data-disabled:shadow-none";

function Input({ className, type, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(controlClasses, "placeholder:text-tertiary", className)}
      {...props}
    />
  );
}

export { Input, controlClasses };
