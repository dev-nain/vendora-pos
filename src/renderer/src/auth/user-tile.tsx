import { CircleCheckIcon } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";

import type { LoginUser } from "@shared/auth";
import { cn } from "@renderer/lib/utils";
import { Avatar } from "./avatar";
import { roleLabel } from "./role-label";

interface UserTileProps {
  user: LoginUser;
  selected: boolean;
  detail?: string | undefined;
  autoFocus?: boolean;
  tileRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function UserTile({
  user,
  selected,
  detail,
  autoFocus,
  tileRef,
  onClick,
  onKeyDown,
}: UserTileProps) {
  return (
    <button
      ref={tileRef}
      type="button"
      autoFocus={autoFocus}
      aria-pressed={selected}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex min-h-[108px] touch-manipulation flex-col items-start gap-300 rounded-300 border border-line-card p-[14px] text-left outline-none transition-[background-color,box-shadow] duration-[var(--duration-100)] ease-[var(--ease-out)] focus-visible:shadow-focus",
        selected
          ? "selection-pill hover:bg-surface-selected"
          : "bg-fill-secondary hover:bg-fill-secondary-hover",
      )}
    >
      <Avatar name={user.displayName} />
      {selected ? (
        <CircleCheckIcon
          aria-hidden="true"
          size={20}
          strokeWidth={2}
          className="absolute top-300 right-300 text-brand"
        />
      ) : null}
      <span className="grid gap-100">
        <span className="text-[length:var(--font-size-400)] leading-[var(--line-height-tight)] font-semibold text-foreground">
          {user.displayName}
        </span>
        <span className="text-[length:var(--font-size-350)] text-tertiary">
          {roleLabel(user.role)}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
    </button>
  );
}
