import { CircleXIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { LoginUser } from "@shared/auth";
import type { GatedAction } from "@shared/gated-actions";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Kbd } from "@renderer/components/ui/kbd";
import { approverChoices } from "./approvers";
import { gatedActionLabels } from "./gated-action-labels";
import { isUnauthenticatedError } from "./messages";
import { PinPad } from "./pin-pad";
import { usePinCooldown } from "./use-pin-cooldown";
import { UserTile } from "./user-tile";

type ApproversState =
  | { name: "loading" }
  | { name: "error" }
  | { name: "ready"; approvers: LoginUser[] };

interface ApprovalDialogProps {
  action: GatedAction;
  onApproved: (token: string, approver: LoginUser) => void;
  onCancel: () => void;
  onUnauthenticated: () => void;
  finalFocus: RefObject<HTMLElement | null>;
}

export function ApprovalDialog({
  action,
  onApproved,
  onCancel,
  onUnauthenticated,
  finalFocus,
}: ApprovalDialogProps) {
  const [state, setState] = useState<ApproversState>({ name: "loading" });
  const [selected, setSelected] = useState<LoginUser | null>(null);
  const cooldown = usePinCooldown(selected?.id ?? null);
  const settled = useRef(false);

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  const load = useCallback(() => {
    window.vendora.auth
      .listLoginUsers()
      .then((users) => setState({ name: "ready", approvers: approverChoices(users, action) }))
      .catch((caught: unknown) => {
        if (isUnauthenticatedError(caught)) onUnauthenticated();
        else setState({ name: "error" });
      });
  }, [action, onUnauthenticated]);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : cancel())}>
      <DialogContent
        finalFocus={finalFocus}
        className="max-h-[calc(100vh-32px)] w-[min(780px,calc(100vw-32px))] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{gatedActionLabels[action]}</DialogTitle>
          <DialogDescription>Ask a manager or the owner to enter their PIN.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-600 px-600 pb-600">
          <div className="min-w-0 flex-1">
            {state.name === "error" ? (
              <div className="grid justify-items-start gap-400">
                <p role="alert" className="m-0 flex items-center gap-100 text-critical">
                  <CircleXIcon aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
                  Couldn't load approvers. Try again.
                </p>
                <Button variant="secondary" onClick={retry}>
                  Retry
                </Button>
              </div>
            ) : null}
            {state.name === "ready" && state.approvers.length === 0 ? (
              <p className="m-0 text-secondary">No manager or owner account is active.</p>
            ) : null}
            {state.name === "ready" && state.approvers.length > 0 ? (
              <div className="grid grid-cols-2 gap-300">
                {state.approvers.map((approver, index) => (
                  <UserTile
                    key={approver.id}
                    user={approver}
                    selected={selected?.id === approver.id}
                    autoFocus={index === 0}
                    onClick={() => setSelected(approver)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid w-[368px] shrink-0 content-start justify-items-center gap-400 rounded-300 border border-line-card bg-surface p-400">
            {selected ? (
              <>
                <h2 className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
                  PIN for {selected.displayName}
                </h2>
                <PinPad
                  key={selected.id}
                  userId={selected.id}
                  submitLabel="Approve"
                  cooldown={cooldown}
                  submitPin={async (pin) => {
                    const result = await window.vendora.auth.approve(action, selected.id, pin);
                    if (result.ok) {
                      settled.current = true;
                      onApproved(result.token, selected);
                    }
                    return result;
                  }}
                  onUnauthenticated={onUnauthenticated}
                  onEscape={cancel}
                />
              </>
            ) : (
              <p className="m-0 py-1000 text-secondary">Choose who is approving</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>
            Cancel
            <Kbd>Esc</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
