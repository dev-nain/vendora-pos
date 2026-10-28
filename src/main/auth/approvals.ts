import { randomBytes } from "node:crypto";
import type { GatedAction } from "../../shared/gated-actions";
import { ApprovalError } from "./errors";
import { requireSession } from "./guard";
import type { SessionStore } from "./session";

export const APPROVAL_TTL_MS = 60_000;

interface ApprovalEntry {
  action: GatedAction;
  requestedByUserId: string;
  approverUserId: string;
  issuedAt: number;
}

interface IssueApprovalInput {
  action: GatedAction;
  requestedByUserId: string;
  approverUserId: string;
}

export function createApprovalStore({
  sessions,
  now = () => new Date(),
}: {
  sessions: SessionStore;
  now?: () => Date;
}) {
  const entries = new Map<string, ApprovalEntry>();

  function prune(at: number): void {
    for (const [token, entry] of entries) {
      if (at - entry.issuedAt >= APPROVAL_TTL_MS) entries.delete(token);
    }
  }

  return {
    issueApproval(input: IssueApprovalInput): string {
      const issuedAt = now().getTime();
      prune(issuedAt);
      const token = randomBytes(32).toString("base64url");
      entries.set(token, { ...input, issuedAt });
      return token;
    },

    consumeApproval(
      token: string,
      action: GatedAction,
    ): { approverUserId: string; requestedByUserId: string } {
      const session = requireSession(sessions);
      const entry = entries.get(token);
      entries.delete(token);
      if (
        !entry ||
        now().getTime() - entry.issuedAt >= APPROVAL_TTL_MS ||
        entry.action !== action ||
        entry.requestedByUserId !== session.userId
      ) {
        throw new ApprovalError();
      }
      return {
        approverUserId: entry.approverUserId,
        requestedByUserId: entry.requestedByUserId,
      };
    },

    clear(): void {
      entries.clear();
    },
  };
}

export type ApprovalStore = ReturnType<typeof createApprovalStore>;
