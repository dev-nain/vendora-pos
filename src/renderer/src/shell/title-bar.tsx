import { Menu } from "@base-ui/react/menu";
import { ArrowLeftRightIcon, LogOutIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import type { SafeUser } from "@shared/auth";
import { Brand } from "@renderer/components/brand";
import { Kbd } from "@renderer/components/ui/kbd";
import { Avatar } from "../auth/avatar";
import { roleLabel } from "../auth/role-label";
import { canOpenBackOffice } from "./back-office-nav";

export type Area = "sell" | "back-office";

interface TitleBarProps {
  user: SafeUser;
  area: Area;
  onAreaChange: (area: Area) => void;
  onSwitchUser: () => void;
  onLogOut: () => void;
}

const tabClasses =
  "relative min-h-[var(--height-title-bar)] rounded-100 px-300 text-[length:var(--font-size-350)] text-secondary outline-none select-none [-webkit-app-region:no-drag] hover:bg-surface-hover hover:text-foreground focus-visible:shadow-focus aria-selected:font-semibold aria-selected:text-foreground aria-selected:after:absolute aria-selected:after:bottom-[2px] aria-selected:after:left-1/2 aria-selected:after:h-[3px] aria-selected:after:w-4 aria-selected:after:-translate-x-1/2 aria-selected:after:rounded-full aria-selected:after:bg-fill-brand aria-selected:after:content-['']";

const itemClasses =
  "flex min-h-[var(--height-control-md)] cursor-default items-center gap-200 rounded-100 px-300 text-[length:var(--font-size-350)] text-foreground outline-none select-none data-highlighted:selection-pill";

export function TitleBar({ user, area, onAreaChange, onSwitchUser, onLogOut }: TitleBarProps) {
  const tabs: { area: Area; label: string }[] = [{ area: "sell", label: "Sell" }];
  if (canOpenBackOffice(user.role)) tabs.push({ area: "back-office", label: "Back office" });

  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = elements.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    const last = elements.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (current + 1) % elements.length
        : event.key === "ArrowLeft"
          ? (current - 1 + elements.length) % elements.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = tabs[target];
    if (!next) return;
    event.preventDefault();
    elements[target]?.focus();
    onAreaChange(next.area);
  };

  return (
    <header
      className="flex items-center bg-page pl-400 text-[length:var(--font-size-300)] [-webkit-app-region:drag]"
      style={{
        paddingRight: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))",
      }}
    >
      <Brand className="text-[length:var(--font-size-300)] text-foreground" />
      <div
        role="tablist"
        aria-label="Area"
        className="ml-200 flex gap-050 pl-200"
        onKeyDown={moveTab}
      >
        {tabs.map((tab) => (
          <button
            key={tab.area}
            type="button"
            role="tab"
            id={`tab-${tab.area}`}
            aria-selected={area === tab.area}
            aria-controls={`panel-${tab.area}`}
            tabIndex={area === tab.area ? 0 : -1}
            className={tabClasses}
            onClick={() => onAreaChange(tab.area)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <Menu.Root>
        <Menu.Trigger
          autoFocus
          data-user-menu-trigger
          className="flex min-h-[var(--height-title-bar)] items-center gap-200 rounded-100 px-200 text-[length:var(--font-size-300)] text-foreground outline-none select-none [-webkit-app-region:no-drag] hover:bg-surface-hover focus-visible:shadow-focus data-popup-open:bg-surface-hover"
        >
          <Avatar name={user.displayName} className="size-6 text-[10px]" />
          {user.displayName}
          <span className="sr-only">, {roleLabel(user.role)}. Account menu</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50 outline-none">
            <Menu.Popup className="min-w-[220px] origin-(--transform-origin) rounded-300 border border-line-card bg-surface-secondary p-100 text-foreground shadow-200 outline-none transition-[opacity,scale] duration-[var(--duration-200)] ease-[var(--ease-out)] data-ending-style:opacity-0 data-starting-style:scale-[var(--scale-enter)] data-starting-style:opacity-0">
              <Menu.Item className={itemClasses} onClick={onSwitchUser}>
                <ArrowLeftRightIcon aria-hidden="true" size={16} strokeWidth={2} />
                Switch user
                <Kbd className="ml-auto">Ctrl+L</Kbd>
              </Menu.Item>
              <Menu.Item className={itemClasses} onClick={onLogOut}>
                <LogOutIcon aria-hidden="true" size={16} strokeWidth={2} />
                Log out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </header>
  );
}
