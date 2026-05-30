"use client";

import * as React from "react";

import type { ArtifactType, EvidenceArtifact } from "@/lib/evidence";
import { cn } from "@/lib/utils";

import { ArtifactLabelBadge } from "./artifact-label-badge";
import { ArtifactTypeIcon } from "./artifact-type-icon";

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  folder: "Folder",
  raw_html: "Raw HTML",
  markdown: "Markdown",
  screenshot: "Screenshot",
  diff: "Diff",
  claim_ledger: "Claim Ledger",
  signal_brief: "Signal Brief",
  verdict_json: "Verdict JSON",
  csv_export: "CSV Export",
  public_news: "Public News",
  report: "Report",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function formatArtifactType(type: ArtifactType): string {
  return ARTIFACT_TYPE_LABELS[type] ?? type;
}

function formatModifiedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return `${DATE_FORMATTER.format(date)} ${TIME_FORMATTER.format(date)}`;
}

export interface EvidenceTableProps {
  artifacts: EvidenceArtifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  checkedIds: Set<string>;
  onToggleCheck: (id: string) => void;
  onToggleCheckAll: () => void;
  viewMode: "compact" | "comfortable";
}

export function EvidenceTable({
  artifacts,
  selectedId,
  onSelect,
  checkedIds,
  onToggleCheck,
  onToggleCheckAll,
  viewMode,
}: EvidenceTableProps) {
  const checkboxRef = React.useRef<HTMLInputElement | null>(null);
  const checkedCount = artifacts.filter((artifact) => checkedIds.has(artifact.id)).length;
  const allChecked = artifacts.length > 0 && checkedCount === artifacts.length;
  const someChecked = checkedCount > 0 && !allChecked;

  React.useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  const cellPadding = viewMode === "compact" ? "px-3 py-2" : "px-3 py-3";

  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant bg-white">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-outline-variant text-left text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">
            <th className="w-10 px-3 py-3">
              <input
                ref={checkboxRef}
                type="checkbox"
                checked={allChecked}
                onChange={onToggleCheckAll}
                aria-label="Select all evidence artifacts"
                className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
              />
            </th>
            <th className="px-3 py-3">Name</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Source</th>
            <th className="px-3 py-3">Modified</th>
            <th className="px-3 py-3">Size</th>
            <th className="px-3 py-3">Labels</th>
          </tr>
        </thead>

        <tbody>
          {artifacts.map((artifact) => {
            const overflowCount = Math.max(artifact.labels.length - 2, 0);
            const visibleLabels = artifact.labels.slice(0, 2);
            const isSelected = artifact.id === selectedId;
            const isFolder = artifact.type === "folder";

            return (
              <tr
                key={artifact.id}
                tabIndex={0}
                className={cn(
                  "cursor-pointer border-b border-outline-variant/50 transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                  isSelected && "bg-primary/5"
                )}
                onClick={() => onSelect(artifact.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(artifact.id);
                  }
                }}
              >
                <td className={cn(cellPadding, "w-10")}>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(artifact.id)}
                    onChange={() => onToggleCheck(artifact.id)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${artifact.name}`}
                    className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                  />
                </td>
                <td className={cellPadding}>
                  <div className="flex items-center gap-2">
                    <ArtifactTypeIcon type={artifact.type} />
                    <span className={cn("truncate text-sm text-on-surface", isFolder && "font-semibold")}>
                      {artifact.name}
                    </span>
                  </div>
                </td>
                <td className={cn(cellPadding, "text-sm text-on-surface-variant")}>
                  {formatArtifactType(artifact.type)}
                </td>
                <td className={cn(cellPadding, "text-sm text-on-surface-variant")}>{artifact.source}</td>
                <td className={cn(cellPadding, "text-sm text-on-surface-variant")}>
                  {formatModifiedAt(artifact.modifiedAt)}
                </td>
                <td className={cn(cellPadding, "text-sm text-on-surface-variant")}>
                  {artifact.type === "folder" ? "—" : artifact.size ?? "—"}
                </td>
                <td className={cellPadding}>
                  {artifact.labels.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {visibleLabels.map((label) => (
                        <ArtifactLabelBadge key={`${artifact.id}-${label}`} label={label} />
                      ))}
                      {overflowCount > 0 ? (
                        <span className="inline-flex items-center rounded-full border border-outline-variant px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
                          +{overflowCount}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-sm text-on-surface-variant">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
