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
        "relative flex min-h-[108px] touch-manipulation flex-col items-start gap-300 rounded-400 border border-line-card bg-surface p-[14px] text-left shadow-200 outline-none transition-[scale,background-color,border-color,box-shadow] duration-[var(--duration-release)] ease-[var(--ease-out)] hover:bg-surface-hover focus-visible:shadow-focus active:scale-[var(--scale-press)] active:duration-[var(--duration-100)]",
        selected &&
          "border-2 border-line-brand p-[13px] shadow-[0_0_0_4px_var(--color-bg-surface-selected)] hover:bg-surface",
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
