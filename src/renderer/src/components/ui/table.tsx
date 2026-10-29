import type { ComponentProps } from "react";

import { cn } from "@renderer/lib/utils";

function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="overflow-x-auto rounded-400 border border-line-card bg-surface shadow-200"
    >
      <table
        data-slot="table"
        className={cn("w-full border-collapse text-[length:var(--font-size-400)]", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&>tr:last-child>td]:border-b-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-surface-secondary font-medium", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors duration-[var(--duration-100)] hover:bg-surface-hover aria-selected:bg-surface-selected aria-selected:[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-border-brand)]",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "sticky top-0 z-10 h-[38px] bg-material px-400 text-left text-[length:var(--font-size-300)] font-semibold whitespace-nowrap text-tertiary shadow-[inset_0_-1px_0_var(--color-border)] backdrop-blur-material backdrop-saturate-[1.7]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-[var(--height-row)] border-b border-dashed border-line px-400 dark:border-solid",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-[length:var(--font-size-350)] text-secondary", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
