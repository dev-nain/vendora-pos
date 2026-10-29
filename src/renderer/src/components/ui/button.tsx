import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@renderer/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 touch-manipulation items-center justify-center gap-200 rounded-300 border border-transparent text-[length:var(--font-size-350)] font-semibold whitespace-nowrap outline-none select-none transition-[scale,background-color,border-color,color,box-shadow] duration-[var(--duration-release)] ease-[var(--ease-out)] focus-visible:shadow-focus active:scale-[var(--scale-press)] active:duration-[var(--duration-100)] disabled:pointer-events-none disabled:border-line disabled:bg-surface-secondary disabled:text-disabled [&_[data-slot=kbd]]:bg-transparent",
  {
    variants: {
      variant: {
        default:
          "bg-fill-brand text-on-brand hover:bg-fill-brand-hover active:bg-fill-brand-active [&_[data-slot=kbd]]:border-current/35 [&_[data-slot=kbd]]:text-on-brand",
        secondary:
          "border-strong bg-fill-secondary text-foreground hover:border-line-hover hover:bg-fill-secondary-hover active:bg-fill-secondary-active",
        ghost: "bg-transparent text-secondary hover:bg-surface-hover hover:text-foreground",
        destructive:
          "bg-fill-critical text-on-critical hover:bg-fill-critical-hover [&_[data-slot=kbd]]:border-current/35 [&_[data-slot=kbd]]:text-on-critical",
      },
      size: {
        default: "min-h-[var(--height-control-md)] px-400",
        sm: "min-h-[var(--height-control-sm)] px-300",
        lg: "min-h-[var(--height-control-lg)] px-600 text-[length:var(--font-size-450)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
