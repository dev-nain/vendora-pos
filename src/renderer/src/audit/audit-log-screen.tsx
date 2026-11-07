import { ChevronLeftIcon, ChevronRightIcon, ScrollTextIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  auditActionLabels,
  auditActions,
  type AuditCursor,
  type AuditPage,
  type AuditUser,
} from "@shared/audit";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { formatDateTime } from "../lib/date-time";
import { isTypingTarget } from "../products/product-list";
import { ErrorLine } from "../users/form-parts";
import {
  dateRangeError,
  emptyAuditFilters,
  newerPage,
  olderPage,
  pageRangeText,
  queryFor,
  type AuditFilters,
} from "./audit-paging";
import { summariseAudit } from "./audit-summary";

const ALL = "all";

const actionItems = [
  { value: ALL, label: "All actions" },
  ...auditActions
    .map((action) => ({ value: action, label: auditActionLabels[action] }))
    .toSorted((a, b) => a.label.localeCompare(b.label)),
];

interface AuditLogScreenProps {
  onSessionEnded: () => void;
}

export function AuditLogScreen({ onSessionEnded }: AuditLogScreenProps) {
  const [filters, setFilters] = useState<AuditFilters>(emptyAuditFilters);
  const [cursors, setCursors] = useState<AuditCursor[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const region = useRef<HTMLDivElement | null>(null);

  const rangeError = dateRangeError(filters.from, filters.to);
  const query = useMemo(() => queryFor(filters, cursors), [filters, cursors]);
  const key = JSON.stringify([query, reloadKey]);

  useEffect(() => {
    window.vendora.audit
      .listUsers()
      .then(setUsers)
      .catch((cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [onSessionEnded]);

  useEffect(() => {
    if (rangeError) return;
    const mine = ++request.current;
    window.vendora.audit
      .list(query)
      .then((next) => {
        if (mine !== request.current) return;
        setPage(next);
        setLoadedKey(key);
        setError(null);
        if (region.current) region.current.scrollTop = 0;
      })
      .catch((cause: unknown) => {
        if (mine !== request.current) return;
        if (isSessionError(cause)) onSessionEnded();
        else setError(serviceErrorMessage);
      });
  }, [query, key, rangeError, onSessionEnded]);

  const goOlder = () => {
    if (page?.nextCursor) setCursors((current) => olderPage(current, page.nextCursor));
  };
  const goNewer = () => setCursors((current) => newerPage(current));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
      if (event.key === "PageDown" && page?.nextCursor) {
        event.preventDefault();
        const next = page.nextCursor;
        setCursors((current) => olderPage(current, next));
      } else if (event.key === "PageUp" && cursors.length > 0) {
        event.preventDefault();
        setCursors((current) => newerPage(current));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, cursors.length]);

  const changeFilters = (patch: Partial<AuditFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([]);
  };

  const userItems = [
    { value: ALL, label: "All users" },
    ...users.map((user) => ({ value: user.id, label: user.displayName })),
  ];
  const hasFilters = Object.values(filters).some((value) => value !== "");
  const entries = page?.entries ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-400">
      <div className="grid gap-100">
        <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
          Audit log
        </h1>
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
          Who did what, and when. Entries can&apos;t be changed.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-300">
        <Select
          items={userItems}
          value={filters.userId || ALL}
          onValueChange={(next) => {
            if (typeof next === "string") changeFilters({ userId: next === ALL ? "" : next });
          }}
        >
          <SelectTrigger autoFocus aria-label="User" className="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {userItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={actionItems}
          value={filters.action || ALL}
          onValueChange={(next) => {
            if (typeof next === "string") changeFilters({ action: next === ALL ? "" : next });
          }}
        >
          <SelectTrigger aria-label="Action" className="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {actionItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-200 text-[length:var(--font-size-350)] text-secondary">
          From
          <Input
            type="date"
            value={filters.from}
            className="w-[160px]"
            onChange={(event) => changeFilters({ from: event.target.value })}
          />
        </label>
        <label className="flex items-center gap-200 text-[length:var(--font-size-350)] text-secondary">
          To
          <Input
            type="date"
            value={filters.to}
            className="w-[160px]"
            onChange={(event) => changeFilters({ to: event.target.value })}
          />
        </label>
        <Button
          variant="ghost"
          disabled={!hasFilters}
          focusableWhenDisabled
          onClick={() => {
            setFilters(emptyAuditFilters);
            setCursors([]);
          }}
        >
          Clear filters
        </Button>
      </div>
      {rangeError ? <ErrorLine>{rangeError}</ErrorLine> : null}
      {error ? (
        <div className="flex items-center gap-300">
          <ErrorLine>{error}</ErrorLine>
          <Button variant="secondary" onClick={() => setReloadKey((current) => current + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {page === null ? (
        error ? null : (
          <p className="m-0 text-secondary">Loading audit log…</p>
        )
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-100 rounded-300 border border-line-card bg-surface-secondary py-1200 text-center">
          <ScrollTextIcon
            aria-hidden="true"
            size={24}
            strokeWidth={2}
            className="text-icon-muted"
          />
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            No entries found
          </p>
          <p className="m-0 text-secondary">Try a different user, action or date.</p>
        </div>
      ) : (
        <div
          ref={region}
          role="region"
          aria-label="Audit entries"
          aria-busy={!rangeError && loadedKey !== key}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto rounded-300 outline-none focus-visible:shadow-focus"
        >
          <Table className="table-fixed" aria-label="Audit log">
            <colgroup>
              <col className="w-[190px]" />
              <col className="w-[170px]" />
              <col className="w-[170px]" />
              <col />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-secondary tabular-nums">
                    {formatDateTime(entry.createdAt)}
                  </TableCell>
                  <TableCell className="text-foreground">{entry.actorName}</TableCell>
                  <TableCell className="text-secondary">
                    {auditActionLabels[entry.action]}
                  </TableCell>
                  <TableCell className="py-200 break-words text-foreground">
                    {summariseAudit(entry)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between">
        <p
          role="status"
          className="m-0 text-[length:var(--font-size-350)] text-secondary tabular-nums"
        >
          {page ? pageRangeText(cursors.length, entries.length) : ""}
        </p>
        <div className="flex items-center gap-200">
          <Button
            variant="secondary"
            disabled={cursors.length === 0}
            focusableWhenDisabled
            onClick={goNewer}
          >
            <ChevronLeftIcon aria-hidden="true" size={16} strokeWidth={2} />
            Newer
            <Kbd>PgUp</Kbd>
          </Button>
          <Button
            variant="secondary"
            disabled={!page?.nextCursor}
            focusableWhenDisabled
            onClick={goOlder}
          >
            Older
            <Kbd>PgDn</Kbd>
            <ChevronRightIcon aria-hidden="true" size={16} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}
