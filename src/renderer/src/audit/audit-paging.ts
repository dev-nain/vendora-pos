import {
  AUDIT_PAGE_SIZE,
  auditActions,
  type AuditCursor,
  type AuditListQuery,
} from "@shared/audit";

export interface AuditFilters {
  userId: string;
  action: string;
  from: string;
  to: string;
}

export const emptyAuditFilters: AuditFilters = { userId: "", action: "", from: "", to: "" };

export function olderPage(cursors: AuditCursor[], nextCursor: AuditCursor | null): AuditCursor[] {
  return nextCursor ? [...cursors, nextCursor] : cursors;
}

export function newerPage(cursors: AuditCursor[]): AuditCursor[] {
  return cursors.slice(0, -1);
}

export function pageRangeText(pagesBack: number, count: number): string {
  if (count === 0) return "No entries";
  const first = pagesBack * AUDIT_PAGE_SIZE + 1;
  return `Showing ${first}–${first + count - 1}`;
}

export function queryFor(filters: AuditFilters, cursors: AuditCursor[]): AuditListQuery {
  const before = cursors.at(-1);
  const action = auditActions.find((candidate) => candidate === filters.action);
  return {
    ...(filters.userId && { userId: filters.userId }),
    ...(action && { action }),
    ...(filters.from && { from: filters.from }),
    ...(filters.to && { to: filters.to }),
    ...(before && { before }),
  };
}

export function dateRangeError(from: string, to: string): string | null {
  return from && to && from > to ? "From must not be after To." : null;
}
