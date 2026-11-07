import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  ClipboardCheckIcon,
  PackageOpenIcon,
  type LucideIcon,
} from "lucide-react";

import { purchaseOrderStatusLabels, type PurchaseOrderStatus } from "@shared/purchase-orders";
import { Badge } from "@renderer/components/ui/badge";

const appearance: Record<
  PurchaseOrderStatus,
  { icon: LucideIcon; variant: "neutral" | "warning" | "success" | "critical" }
> = {
  draft: { icon: CircleDashedIcon, variant: "neutral" },
  confirmed: { icon: ClipboardCheckIcon, variant: "neutral" },
  partly_received: { icon: PackageOpenIcon, variant: "warning" },
  received: { icon: CircleCheckIcon, variant: "success" },
  cancelled: { icon: CircleSlashIcon, variant: "critical" },
};

export function OrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { icon: Icon, variant } = appearance[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" strokeWidth={2} />
      {purchaseOrderStatusLabels[status]}
    </Badge>
  );
}
