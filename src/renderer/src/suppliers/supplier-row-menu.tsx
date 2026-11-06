import { Menu } from "@base-ui/react/menu";
import { ArchiveIcon, ArchiveRestoreIcon, EllipsisIcon, PencilIcon } from "lucide-react";

import type { Supplier } from "@shared/suppliers";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { itemClasses } from "../products/product-row-menu";

interface SupplierRowMenuProps {
  supplier: Supplier;
  onEdit: () => void;
  onToggleArchive: () => void;
}

export function SupplierRowMenu({ supplier, onEdit, onToggleArchive }: SupplierRowMenuProps) {
  const ArchiveToggleIcon = supplier.isArchived ? ArchiveRestoreIcon : ArchiveIcon;
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            className="size-[var(--height-control-md)] p-0"
            aria-label={`Actions for ${supplier.name}`}
            title="Actions"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" size={16} strokeWidth={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50 outline-none">
          <Menu.Popup className="min-w-[200px] origin-(--transform-origin) rounded-300 border border-line-card bg-surface-secondary p-100 text-foreground shadow-200 outline-none transition-[opacity,scale] duration-[var(--duration-200)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-starting-style:scale-[var(--scale-enter)] data-starting-style:opacity-0">
            <Menu.Item className={itemClasses} onClick={onEdit}>
              <PencilIcon aria-hidden="true" size={16} strokeWidth={2} />
              Edit
              <Kbd className="ml-auto">Enter</Kbd>
            </Menu.Item>
            <Menu.Item className={itemClasses} onClick={onToggleArchive}>
              <ArchiveToggleIcon aria-hidden="true" size={16} strokeWidth={2} />
              {supplier.isArchived ? "Restore" : "Archive"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
