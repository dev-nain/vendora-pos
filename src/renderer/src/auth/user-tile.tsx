import type { KeyboardEvent, Ref } from "react";

import type { LoginUser } from "@shared/auth";
import { cn } from "@renderer/lib/utils";
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
        "relative grid min-h-[calc(var(--space-1000)+var(--space-1200))] content-center justify-items-start gap-100 overflow-hidden rounded-300 border border-line bg-surface p-400 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:shadow-focus",
        selected && "bg-surface-selected hover:bg-surface-selected",
      )}
    >
      {selected ? (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-100 bg-fill-brand" />
      ) : null}
      <span className="text-[length:var(--font-size-450)] font-semibold text-foreground">
        {user.displayName}
      </span>
      <span className="text-[length:var(--font-size-350)] text-secondary">
        {roleLabel(user.role)}
        {detail ? ` · ${detail}` : ""}
      </span>
    </button>
  );
}
