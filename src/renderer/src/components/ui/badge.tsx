import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@renderer/lib/utils";

const badgeVariants = cva(
  "inline-flex h-[24px] items-center gap-100 rounded-full px-[10px] text-[length:var(--font-size-300)] font-semibold whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "bg-fill-neutral-secondary text-secondary",
        brand: "bg-fill-brand-secondary text-brand",
        success: "bg-fill-success-secondary text-success",
        warning: "bg-fill-warning-secondary text-warning",
        critical: "bg-fill-critical-secondary text-critical",
        highlight: "bg-fill-highlight text-on-highlight",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant }), className) }, props),
    render,
    state: { slot: "badge", variant },
  });
}

export { Badge, badgeVariants };
