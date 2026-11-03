import { ArchiveIcon, CircleCheckIcon } from "lucide-react";

import type { ProductSearchItem } from "@shared/products";
import { Badge } from "@renderer/components/ui/badge";
import { barcodeSummary, statusLabel } from "./product-list";

export function ProductNameCell({ item }: { item: ProductSearchItem }) {
  return (
    <>
      <span
        title={item.nameEn}
        className="block truncate text-[length:var(--font-size-400)] font-semibold text-foreground"
      >
        {item.nameEn}
      </span>
      {item.nameUr ? (
        <span
          lang="ur"
          dir="rtl"
          className="block truncate font-urdu text-[length:var(--font-size-350)] leading-[var(--line-height-urdu)] text-secondary"
        >
          {item.nameUr}
        </span>
      ) : null}
    </>
  );
}

export function BarcodeCell({ item }: { item: ProductSearchItem }) {
  const { primary, extra } = barcodeSummary(item);
  if (primary === null) {
    return (
      <>
        <span aria-hidden="true" className="text-tertiary">
          —
        </span>
        <span className="sr-only">No barcode</span>
      </>
    );
  }
  return (
    <span className="flex items-center gap-200">
      <span className="truncate font-mono text-[length:var(--font-size-350)] text-secondary">
        {primary}
      </span>
      {extra ? (
        <Badge variant="neutral" title={`${item.extraBarcodeCount} more barcodes`}>
          {extra}
          <span className="sr-only"> more barcodes</span>
        </Badge>
      ) : null}
    </span>
  );
}

export function StatusBadge({ isActive }: { isActive: boolean }) {
  const Icon = isActive ? CircleCheckIcon : ArchiveIcon;
  return (
    <Badge variant={isActive ? "success" : "neutral"}>
      <Icon aria-hidden="true" strokeWidth={2} />
      {statusLabel(isActive)}
    </Badge>
  );
}
