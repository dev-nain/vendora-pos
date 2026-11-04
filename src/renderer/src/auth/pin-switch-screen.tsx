import { ArrowLeftIcon, CircleXIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { LoginUser, SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { isSessionError } from "./messages";
import { PinPad } from "./pin-pad";
import { PaneHeading, AuthLayout } from "./split-layout";
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
        if (isSessionError(caught)) onUnauthenticated();
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
    <AuthLayout
      back={
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back
          <Kbd>Esc</Kbd>
        </Button>
      }
    >
      <PaneHeading
        title="Switch user"
        description={selected ? `PIN for ${selected.displayName}` : "Choose your name"}
      />

      {usersState.name === "error" ? (
        <div className="grid justify-items-center gap-400">
          <p role="alert" className="m-0 flex items-center gap-100 text-critical">
            <CircleXIcon aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
            Couldn't load users. Try again.
          </p>
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {usersState.name === "ready" ? (
        <div className="grid grid-cols-[repeat(3,168px)] gap-300">
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

      {selected ? (
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
      ) : null}
    </AuthLayout>
  );
}
