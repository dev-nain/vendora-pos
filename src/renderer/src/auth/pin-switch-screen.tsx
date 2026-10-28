import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { LoginUser, SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { isUnauthenticatedError } from "./messages";
import { PinPad } from "./pin-pad";
import { UserTile } from "./user-tile";
import { usePinCooldown } from "./use-pin-cooldown";

type UsersState = { name: "loading" } | { name: "error" } | { name: "ready"; users: LoginUser[] };

interface PinSwitchScreenProps {
  currentUserId: string;
  onBack: () => void;
  onSwitched: (user: SafeUser) => void;
  onUnauthenticated: () => void;
}

export function PinSwitchScreen({
  currentUserId,
  onBack,
  onSwitched,
  onUnauthenticated,
}: PinSwitchScreenProps) {
  const [usersState, setUsersState] = useState<UsersState>({ name: "loading" });
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const cooldown = usePinCooldown(selected?.id ?? null);

  const loadUsers = useCallback(() => {
    window.vendora.auth
      .listLoginUsers()
      .then((users) => setUsersState({ name: "ready", users }))
      .catch((caught: unknown) => {
        if (isUnauthenticatedError(caught)) onUnauthenticated();
        else setUsersState({ name: "error" });
      });
  }, [onUnauthenticated]);

  useEffect(loadUsers, [loadUsers]);

  const retry = () => {
    setUsersState({ name: "loading" });
    loadUsers();
  };

  const clearSelection = () => {
    const previous = selected;
    setSelected(null);
    if (previous) requestAnimationFrame(() => tiles.current.get(previous.id)?.focus());
  };

  const onTileKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onBack();
    }
  };

  return (
    <main className="flex min-h-screen flex-col gap-600 overflow-x-hidden bg-page p-600">
      <div className="flex items-center gap-400">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back
          <Kbd>Esc</Kbd>
        </Button>
        <h1 className="m-0 text-[length:var(--font-size-700)] font-semibold text-foreground">
          Switch user
        </h1>
      </div>

      <div className="flex min-h-0 flex-1 gap-600">
        <section className="flex-1 overflow-y-auto rounded-300 border border-line bg-surface p-600">
          {usersState.name === "error" ? (
            <div className="grid justify-items-start gap-400">
              <p role="alert" className="m-0 text-critical">
                Couldn't load users. Try again.
              </p>
              <Button variant="secondary" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : null}
          {usersState.name === "ready" ? (
            <div className="grid grid-cols-3 gap-400">
              {usersState.users.map((user, index) => {
                const isSelected = selected?.id === user.id;
                return (
                  <UserTile
                    key={user.id}
                    user={user}
                    selected={isSelected}
                    detail={user.id === currentUserId ? "Signed in" : undefined}
                    autoFocus={index === 0}
                    tileRef={(node) => {
                      if (node) tiles.current.set(user.id, node);
                      else tiles.current.delete(user.id);
                    }}
                    onClick={() => setSelected(user)}
                    onKeyDown={onTileKeyDown}
                  />
                );
              })}
            </div>
          ) : null}
        </section>

        <section className="grid w-[360px] shrink-0 content-start gap-400 overflow-y-auto rounded-300 border border-line bg-surface p-600">
          {selected ? (
            <>
              <h2 className="m-0 text-[length:var(--font-size-550)] font-semibold text-foreground">
                PIN for {selected.displayName}
              </h2>
              <PinPad
                key={selected.id}
                userId={selected.id}
                submitLabel="Switch"
                cooldown={cooldown}
                submitPin={async (pin) => {
                  const result = await window.vendora.auth.switchByPin(selected.id, pin);
                  if (result.ok) onSwitched(result.user);
                  return result;
                }}
                onUnauthenticated={onUnauthenticated}
                onEscape={clearSelection}
              />
            </>
          ) : (
            <p className="m-0 text-secondary">Choose your name</p>
          )}
        </section>
      </div>
    </main>
  );
}
