import {
  ArrowLeftIcon,
  CircleSlashIcon,
  CircleCheckIcon,
  ClockIcon,
  UserPlusIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ManagedUser } from "@shared/users";
import { Button } from "@renderer/components/ui/button";
import { Badge } from "@renderer/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { Avatar } from "../auth/avatar";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { roleLabel } from "../auth/role-label";
import { CreateUserDialog } from "./create-user-dialog";
import { DeactivateUserDialog } from "./deactivate-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";
import { ErrorLine } from "./form-parts";
import { ResetCredentialDialog } from "./reset-credential-dialog";
import { userStatusLabels } from "./user-status";

type DialogState =
  | { kind: "create"; open: boolean }
  | { kind: "edit"; user: ManagedUser; open: boolean }
  | { kind: "reset-password" | "reset-pin" | "deactivate"; user: ManagedUser; open: boolean }
  | null;

interface UsersScreenProps {
  currentUserId: string;
  onBack: () => void;
  onSessionEnded: () => void;
}

function StatusBadges({ user }: { user: ManagedUser }) {
  const labels = userStatusLabels(user);
  return (
    <div className="flex flex-wrap items-center gap-200">
      {labels.map((label) => {
        const Icon =
          label === "Active" ? CircleCheckIcon : label === "Inactive" ? CircleSlashIcon : ClockIcon;
        const variant =
          label === "Active" ? "success" : label === "Inactive" ? "neutral" : "warning";
        return (
          <Badge key={label} variant={variant}>
            <Icon aria-hidden="true" strokeWidth={2} />
            {label}
          </Badge>
        );
      })}
    </div>
  );
}

export function UsersScreen({ currentUserId, onBack, onSessionEnded }: UsersScreenProps) {
  const [rows, setRows] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const setOpen = (open: boolean) =>
    setDialog((current) => (current ? { ...current, open } : null));

  const fail = useCallback(
    (cause: unknown) => {
      if (isSessionError(cause)) {
        onSessionEnded();
        return;
      }
      setError(serviceErrorMessage);
    },
    [onSessionEnded],
  );

  const refresh = useCallback(() => {
    window.vendora.users
      .list()
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch(fail);
  }, [fail]);

  useEffect(refresh, [refresh]);

  const reactivate = async (user: ManagedUser) => {
    try {
      await window.vendora.users.reactivate(user.id);
      refresh();
    } catch (cause) {
      fail(cause);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-600 p-800">
      <div className="flex items-start gap-400">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
          Back
        </Button>
        <div className="grid flex-1 gap-100">
          <h1 className="m-0 text-[length:var(--font-size-700)] leading-[var(--line-height-tight)] font-bold tracking-[var(--letter-spacing-heading)] text-foreground">
            Users
          </h1>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            Add staff and control who can log in.
          </p>
        </div>
        <Button autoFocus onClick={() => setDialog({ kind: "create", open: true })}>
          <UserPlusIcon aria-hidden="true" size={16} strokeWidth={2} />
          Add user
        </Button>
      </div>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {rows === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading users…</p>
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-300">
                    <Avatar name={user.displayName} />
                    <div className="grid leading-[var(--line-height-tight)]">
                      <span className="text-[length:var(--font-size-400)] font-semibold text-foreground">
                        {user.displayName}
                        {user.id === currentUserId ? (
                          <span className="font-normal text-tertiary"> (you)</span>
                        ) : null}
                      </span>
                      <span className="text-[length:var(--font-size-350)] text-tertiary">
                        {user.username}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{roleLabel(user.role)}</TableCell>
                <TableCell>
                  <StatusBadges user={user} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-200">
                    <Button
                      variant="secondary"
                      onClick={() => setDialog({ kind: "edit", user, open: true })}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setDialog({ kind: "reset-password", user, open: true })}
                    >
                      Reset password
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setDialog({ kind: "reset-pin", user, open: true })}
                    >
                      Reset PIN
                    </Button>
                    {user.isActive ? (
                      <Button
                        variant="ghost"
                        className="text-critical"
                        onClick={() => setDialog({ kind: "deactivate", user, open: true })}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => void reactivate(user)}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {dialog?.kind === "create" ? (
        <CreateUserDialog
          open={dialog.open}
          onOpenChange={setOpen}
          onCreated={refresh}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EditUserDialog
          user={dialog.user}
          open={dialog.open}
          isCurrentUser={dialog.user.id === currentUserId}
          onOpenChange={setOpen}
          onSaved={refresh}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "reset-password" || dialog?.kind === "reset-pin" ? (
        <ResetCredentialDialog
          kind={dialog.kind === "reset-pin" ? "pin" : "password"}
          user={dialog.user}
          open={dialog.open}
          onOpenChange={setOpen}
          onSaved={refresh}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
      {dialog?.kind === "deactivate" ? (
        <DeactivateUserDialog
          user={dialog.user}
          open={dialog.open}
          isCurrentUser={dialog.user.id === currentUserId}
          onOpenChange={setOpen}
          onDeactivated={refresh}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </main>
  );
}
