import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@renderer/lib/utils";

const controlClasses =
  "w-full min-h-[var(--height-control-md)] rounded-300 border border-input bg-surface px-400 text-[length:var(--font-size-400)] text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--duration-100)] ease-[var(--ease-out)] hover:border-line-hover focus-visible:border-focus focus-visible:shadow-focus aria-invalid:border-line-critical data-invalid:border-line-critical disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-secondary disabled:text-disabled data-disabled:cursor-not-allowed data-disabled:border-line data-disabled:bg-surface-secondary data-disabled:text-disabled";

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
