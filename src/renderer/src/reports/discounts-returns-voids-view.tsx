import { useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@renderer/lib/utils";
import {
  discountsReturnsVoidsSections,
  sectionNote,
  type DiscountsReturnsVoidsResult,
  type ReportSection,
  type SectionId,
} from "@shared/discounts-returns-voids";
import { formatReportCell } from "@shared/reports";
import type { ReportBodyProps } from "./report-definitions";
import { ReportTable } from "./report-table";

type TabId = "discounts" | "returns" | "voids";

const tabs: { id: TabId; label: string }[] = [
  { id: "discounts", label: "Discounts" },
  { id: "returns", label: "Returns" },
  { id: "voids", label: "Voids" },
];

const tabCount = (tab: TabId, { discounts, returns, voids }: DiscountsReturnsVoidsResult) =>
  tab === "discounts"
    ? discounts.billCount
    : tab === "returns"
      ? returns.lineCount
      : voids.deletedLines.count + voids.discardedBills.count;

const splitGrid = "grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-600";

const headingClass = "m-0 text-[length:var(--font-size-450)] font-semibold text-foreground";

const noteClass = "m-0 text-[length:var(--font-size-350)] text-secondary";

interface SectionTableProps {
  section: ReportSection | undefined;
  heading: ReactNode;
  busy: boolean;
  onOpenSale?: ((invoiceNo: string) => void) | undefined;
}

function SectionTable({ section, heading, busy, onOpenSale }: SectionTableProps) {
  if (!section) return null;
  const note = sectionNote(section);
  return (
    <div className="flex min-h-0 flex-col gap-200">
      <h2 className={headingClass}>{heading}</h2>
      {section.rows.length === 0 ? (
        <p className={noteClass}>None in this period.</p>
      ) : (
        <ReportTable
          label={`${section.title} table`}
          busy={busy}
          columns={section.columns}
          rows={section.rows}
          rowKey={section.rowKey}
          totals={section.totals}
          onOpenSale={onOpenSale}
        />
      )}
      {note ? <p className={noteClass}>{note}</p> : null}
    </div>
  );
}

const totalText = (section: ReportSection | undefined, key: string): string => {
  const column = section?.columns.find((candidate) => candidate.key === key);
  const value = section?.totals?.[key];
  return column && value !== undefined ? formatReportCell(column, value) : "";
};

export function DiscountsReturnsVoidsBody({
  result,
  busy,
  onOpenSale,
}: ReportBodyProps<DiscountsReturnsVoidsResult>) {
  const [tab, setTab] = useState<TabId>("discounts");
  const sections = discountsReturnsVoidsSections(result);
  const section = (id: SectionId) => sections.find((candidate) => candidate.id === id);

  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = elements.findIndex((element) => element === document.activeElement);
    if (current === -1) return;
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (current + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (current - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = tabs[target];
    if (!next) return;
    event.preventDefault();
    elements[target]?.focus();
    setTab(next.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-400">
      <div
        role="tablist"
        aria-label="Report groups"
        className="flex gap-050 self-start"
        onKeyDown={moveTab}
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`report-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="report-panel"
            tabIndex={tab === id ? 0 : -1}
            className={cn(
              "min-h-[var(--height-control-md)] rounded-100 px-400 text-[length:var(--font-size-350)] outline-none select-none focus-visible:shadow-focus",
              tab === id
                ? "selection-pill font-semibold text-foreground hover:bg-surface-selected"
                : "text-secondary hover:bg-surface-hover",
            )}
            onClick={() => setTab(id)}
          >
            {label} · {tabCount(id, result)}
          </button>
        ))}
      </div>
      <div
        id="report-panel"
        role="tabpanel"
        aria-labelledby={`report-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === "discounts" ? (
          <div className={splitGrid}>
            <SectionTable section={section("discounts-by-user")} heading="By user" busy={busy} />
            <SectionTable
              section={section("discounted-bills")}
              heading="By bill"
              busy={busy}
              onOpenSale={onOpenSale}
            />
          </div>
        ) : tab === "returns" ? (
          <div className={splitGrid}>
            <SectionTable section={section("returns-summary")} heading="Summary" busy={busy} />
            <SectionTable
              section={section("returned-lines")}
              heading="Returned lines"
              busy={busy}
              onOpenSale={onOpenSale}
            />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-500">
            <SectionTable
              section={section("deleted-lines")}
              heading={`Deleted lines · ${result.voids.deletedLines.count} · Gross before discount ${totalText(section("deleted-lines"), "grossPaisa")}`}
              busy={busy}
              onOpenSale={onOpenSale}
            />
            <SectionTable
              section={section("discarded-bills")}
              heading={`Discarded bills · ${result.voids.discardedBills.count} · Bill total ${totalText(section("discarded-bills"), "totalPaisa")}`}
              busy={busy}
            />
          </div>
        )}
      </div>
    </div>
  );
}
