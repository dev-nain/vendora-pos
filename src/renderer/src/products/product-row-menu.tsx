import { Menu } from "@base-ui/react/menu";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import type { ProductSearchItem } from "@shared/products";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";

const itemClasses =
  "flex min-h-[var(--height-control-md)] cursor-default items-center gap-200 rounded-100 px-300 text-[length:var(--font-size-350)] text-foreground outline-none select-none data-highlighted:selection-pill";

interface ProductRowMenuProps {
  item: ProductSearchItem;
  onEdit?: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

export function ProductRowMenu({ item, onEdit, onToggleArchive, onDelete }: ProductRowMenuProps) {
  const ArchiveToggleIcon = item.isActive ? ArchiveIcon : ArchiveRestoreIcon;
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            className="size-[var(--height-control-md)] p-0"
            aria-label={`Actions for ${item.nameEn}`}
            title="Actions"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" size={16} strokeWidth={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50 outline-none">
          <Menu.Popup className="min-w-[200px] origin-(--transform-origin) rounded-300 border border-line-card bg-surface-secondary p-100 text-foreground shadow-200 outline-none transition-[opacity,scale] duration-[var(--duration-200)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-starting-style:scale-[var(--scale-enter)] data-starting-style:opacity-0">
            {onEdit ? (
              <Menu.Item className={itemClasses} onClick={onEdit}>
                <PencilIcon aria-hidden="true" size={16} strokeWidth={2} />
                Edit
                <Kbd className="ml-auto">Enter</Kbd>
              </Menu.Item>
            ) : null}
            <Menu.Item className={itemClasses} onClick={onToggleArchive}>
              <ArchiveToggleIcon aria-hidden="true" size={16} strokeWidth={2} />
              {item.isActive ? "Archive" : "Restore"}
            </Menu.Item>
            <Menu.Item className={`${itemClasses} text-critical`} onClick={onDelete}>
              <Trash2Icon aria-hidden="true" size={16} strokeWidth={2} />
              Delete
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
