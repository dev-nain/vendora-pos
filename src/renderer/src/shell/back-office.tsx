import { SettingsIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { cn } from "@renderer/lib/utils";
import { AutoLockSetting } from "../settings/auto-lock-setting";
import { UsersScreen } from "../users/users-screen";

type Page = "users" | "settings";

const pages: { page: Page; label: string; Icon: LucideIcon }[] = [
  { page: "users", label: "Users", Icon: UsersIcon },
  { page: "settings", label: "Settings", Icon: SettingsIcon },
];

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
}

export function BackOffice({ currentUserId, onSessionEnded }: BackOfficeProps) {
  const [page, setPage] = useState<Page>("users");

  return (
    <div
      id="panel-back-office"
      role="tabpanel"
      aria-labelledby="tab-back-office"
      className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)]"
    >
      <nav aria-label="Back office" className="flex flex-col gap-050 p-200" onKeyDown={moveFocus}>
        {pages.map(({ page: id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={page === id ? "page" : undefined}
            tabIndex={page === id ? 0 : -1}
            className={cn(
              "flex min-h-[var(--height-control-md)] items-center gap-[14px] rounded-100 px-400 text-left text-[length:var(--font-size-350)] text-foreground outline-none select-none hover:bg-surface-hover focus-visible:shadow-focus",
              page === id && "selection-pill",
            )}
            onClick={() => setPage(id)}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} className="text-icon-muted" />
            {label}
          </button>
        ))}
      </nav>
      <section className="min-w-0 overflow-y-auto rounded-tl-300 border-t border-l border-line-card bg-surface px-[36px] py-[28px]">
        {page === "users" ? (
          <UsersScreen currentUserId={currentUserId} onSessionEnded={onSessionEnded} />
        ) : (
          <div className="grid gap-500">
            <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
              Settings
            </h1>
            <AutoLockSetting />
          </div>
        )}
      </section>
    </div>
  );
}
