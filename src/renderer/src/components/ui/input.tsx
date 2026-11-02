import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@renderer/lib/utils";

const controlClasses =
  "w-full min-h-[var(--height-control-md)] rounded-100 border border-strong border-b-input bg-fill-secondary px-300 text-[length:var(--font-size-400)] text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-[var(--duration-100)] ease-[var(--ease-out)] hover:bg-fill-secondary-hover focus-visible:border-b-line-brand focus-visible:bg-surface-secondary focus-visible:shadow-[inset_0_-1px_0_var(--color-border-brand)] aria-invalid:border-b-line-critical data-invalid:border-b-line-critical aria-invalid:focus-visible:shadow-[inset_0_-1px_0_var(--color-border-critical-strong)] data-invalid:focus-visible:shadow-[inset_0_-1px_0_var(--color-border-critical-strong)] disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-hover disabled:text-disabled data-disabled:cursor-not-allowed data-disabled:border-line data-disabled:bg-surface-hover data-disabled:text-disabled";

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
