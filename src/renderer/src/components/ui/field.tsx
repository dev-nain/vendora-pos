import { Field as FieldPrimitive } from "@base-ui/react/field";
import { CircleXIcon } from "lucide-react";

import { cn } from "@renderer/lib/utils";

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root data-slot="field" className={cn("grid gap-200", className)} {...props} />
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        "text-[length:var(--font-size-350)] text-foreground data-disabled:text-disabled",
        className,
      )}
      {...props}
    />
  );
}

function FieldError({ className, children, match = true, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      match={match}
      className={cn(
        "flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical",
        className,
      )}
      {...props}
    >
      <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
      {children}
    </FieldPrimitive.Error>
  );
}

export { Field, FieldLabel, FieldError };
