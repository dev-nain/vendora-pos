import {
  BoxesIcon,
  ClipboardListIcon,
  PackageIcon,
  SettingsIcon,
  TagsIcon,
  TriangleAlertIcon,
  TruckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useState, type KeyboardEvent } from "react";

import type { LowStockItem } from "@shared/inventory";
import { cn } from "@renderer/lib/utils";
import { CategoriesScreen } from "../categories/categories-screen";
import { LowStockScreen } from "../inventory/low-stock-screen";
import { StockScreen } from "../inventory/stock-screen";
import { ProductsScreen } from "../products/products-screen";
import type { LeaveGuard, OrderSeed } from "../purchasing/order-form-screen";
import { PurchaseOrdersScreen } from "../purchasing/purchase-orders-screen";
import { MiscItemSetting } from "../settings/misc-item-setting";
import { PrinterSetting } from "../settings/printer-setting";
import { ReceiptSetting } from "../settings/receipt-setting";
import { ShiftVarianceSetting } from "../settings/shift-variance-setting";
import { SuppliersScreen } from "../suppliers/suppliers-screen";
import { UsersScreen } from "../users/users-screen";
import { backOfficeEntries, type BackOfficePage } from "./back-office-nav";

const icons: Record<BackOfficePage, LucideIcon> = {
  products: PackageIcon,
  categories: TagsIcon,
  stock: BoxesIcon,
  "low-stock": TriangleAlertIcon,
  "purchase-orders": ClipboardListIcon,
  suppliers: TruckIcon,
  users: UsersIcon,
  settings: SettingsIcon,
};

const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
  const current = items.indexOf(document.activeElement as HTMLElement);
  if (current === -1) return;
  event.preventDefault();
  items[(current + step + items.length) % items.length]?.focus();
};

interface BackOfficeProps {
  currentUserId: string;
  onSessionEnded: () => void;
  focusPrinter?: boolean;
  guarded: (go: () => void) => void;
  registerLeaveGuard: (guard: LeaveGuard | null) => void;
}

export function BackOffice({
  currentUserId,
  onSessionEnded,
  focusPrinter,
  guarded,
  registerLeaveGuard,
}: BackOfficeProps) {
  const [page, setPage] = useState<BackOfficePage>(focusPrinter ? "settings" : "products");
  const [orderSeed, setOrderSeed] = useState<OrderSeed | null>(null);
  const clearOrderSeed = useCallback(() => setOrderSeed(null), []);
  const createOrder = useCallback((items: LowStockItem[]) => {
    setOrderSeed(items);
    setPage("purchase-orders");
  }, []);

  const goTo = (next: BackOfficePage) => {
    if (next === page) return;
    guarded(() => setPage(next));
  };

  return (
    <div
      id="panel-back-office"
      role="tabpanel"
      aria-labelledby="tab-back-office"
      className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)]"
    >
      <nav aria-label="Back office" className="flex flex-col gap-050 p-200" onKeyDown={moveFocus}>
        {backOfficeEntries.map(({ page: id, label, group }, index) => {
          const Icon = icons[id];
          return (
            <Fragment key={id}>
              {group && backOfficeEntries[index - 1]?.group !== group ? (
                <p className="m-0 px-400 pt-200 text-[length:var(--font-size-300)] text-tertiary">
                  {group}
                </p>
              ) : null}
              <button
                type="button"
                aria-current={page === id ? "page" : undefined}
                tabIndex={page === id ? 0 : -1}
                className={cn(
                  "flex min-h-[var(--height-control-md)] items-center gap-[14px] rounded-100 px-400 text-left text-[length:var(--font-size-350)] text-foreground outline-none select-none focus-visible:shadow-focus",
                  page === id
                    ? "selection-pill hover:bg-surface-selected"
                    : "hover:bg-surface-hover",
                )}
                onClick={() => goTo(id)}
              >
                <Icon aria-hidden="true" size={16} strokeWidth={2} className="text-icon-muted" />
                {label}
              </button>
            </Fragment>
          );
        })}
      </nav>
      <section className="min-w-0 overflow-y-auto rounded-tl-300 border-t border-l border-line-card bg-surface px-[36px] py-[28px]">
        {page === "products" ? (
          <ProductsScreen onSessionEnded={onSessionEnded} />
        ) : page === "categories" ? (
          <CategoriesScreen onSessionEnded={onSessionEnded} />
        ) : page === "stock" ? (
          <StockScreen onSessionEnded={onSessionEnded} />
        ) : page === "low-stock" ? (
          <LowStockScreen onSessionEnded={onSessionEnded} onCreateOrder={createOrder} />
        ) : page === "purchase-orders" ? (
          <PurchaseOrdersScreen
            seed={orderSeed}
            registerLeaveGuard={registerLeaveGuard}
            onSeedUsed={clearOrderSeed}
            onSessionEnded={onSessionEnded}
          />
        ) : page === "suppliers" ? (
          <SuppliersScreen onSessionEnded={onSessionEnded} />
        ) : page === "users" ? (
          <UsersScreen currentUserId={currentUserId} onSessionEnded={onSessionEnded} />
        ) : page === "settings" ? (
          <div className="grid gap-500">
            <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
              Settings
            </h1>
            <MiscItemSetting />
            <ShiftVarianceSetting />
            <PrinterSetting focusOnReady={focusPrinter === true} />
            <ReceiptSetting />
          </div>
        ) : null}
      </section>
    </div>
  );
}
