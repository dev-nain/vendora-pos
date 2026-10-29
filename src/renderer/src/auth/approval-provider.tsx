import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { LoginUser, SafeUser } from "@shared/auth";
import { gatedActionDecision, type GatedAction } from "@shared/gated-actions";
import { ApprovalDialog } from "./approval-dialog";

export type ApprovalOutcome =
  | { status: "not-needed" }
  | { status: "approved"; token: string; approver: LoginUser }
  | { status: "cancelled" };

interface OpenRequest {
  id: number;
  action: GatedAction;
  resolve: (outcome: ApprovalOutcome) => void;
}

interface ApprovalContextValue {
  requestApproval: (action: GatedAction) => Promise<ApprovalOutcome>;
}

const ApprovalContext = createContext<ApprovalContextValue | null>(null);

export function useApproval(): ApprovalContextValue {
  const value = useContext(ApprovalContext);
  if (!value) throw new Error("useApproval needs an ApprovalProvider");
  return value;
}

interface ApprovalProviderProps {
  user: SafeUser;
  onUnauthenticated: () => void;
  children: ReactNode;
}

export function ApprovalProvider({ user, onUnauthenticated, children }: ApprovalProviderProps) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const open = useRef<OpenRequest | null>(null);
  const finalFocus = useRef<HTMLElement | null>(null);
  const nextId = useRef(0);
  const role = user.role;

  const finish = useCallback((outcome: ApprovalOutcome) => {
    const current = open.current;
    if (!current) return;
    open.current = null;
    setRequest(null);
    current.resolve(outcome);
    const target = finalFocus.current;
    requestAnimationFrame(() => target?.focus());
  }, []);

  const requestApproval = useCallback(
    (action: GatedAction) => {
      if (gatedActionDecision(role, action) === "allowed") {
        return Promise.resolve<ApprovalOutcome>({ status: "not-needed" });
      }
      if (open.current) open.current.resolve({ status: "cancelled" });
      else {
        const active = document.activeElement;
        finalFocus.current = active instanceof HTMLElement ? active : null;
      }
      return new Promise<ApprovalOutcome>((resolve) => {
        nextId.current += 1;
        const next = { id: nextId.current, action, resolve };
        open.current = next;
        setRequest(next);
      });
    },
    [role],
  );

  const value = useMemo(() => ({ requestApproval }), [requestApproval]);

  const lostSession = useCallback(() => {
    finish({ status: "cancelled" });
    onUnauthenticated();
  }, [finish, onUnauthenticated]);

  return (
    <ApprovalContext value={value}>
      {children}
      {request ? (
        <ApprovalDialog
          key={request.id}
          action={request.action}
          finalFocus={finalFocus}
          onApproved={(token, approver) => finish({ status: "approved", token, approver })}
          onCancel={() => finish({ status: "cancelled" })}
          onUnauthenticated={lostSession}
        />
      ) : null}
    </ApprovalContext>
  );
}
