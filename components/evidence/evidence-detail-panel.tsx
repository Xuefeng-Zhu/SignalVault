"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import type { ArtifactType, EvidenceArtifact } from "@/lib/evidence";
import { cn } from "@/lib/utils";
import { Download, Eye, X } from "lucide-react";

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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return `${DATE_FORMATTER.format(date)} ${TIME_FORMATTER.format(date)}`;
}

export interface EvidenceDetailPanelProps {
  artifact: EvidenceArtifact | null;
  allArtifacts: EvidenceArtifact[];
  open: boolean;
  onClose: () => void;
}

export function EvidenceDetailPanel({
  artifact,
  allArtifacts,
  open,
  onClose,
}: EvidenceDetailPanelProps) {
  const [activeTab, setActiveTab] = React.useState<"details" | "activity">("details");

  React.useEffect(() => {
    setActiveTab("details");
  }, [artifact?.id]);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const relatedArtifacts = artifact
    ? (artifact.relatedArtifactIds ?? [])
        .map((relatedId) => allArtifacts.find((c) => c.id === relatedId))
        .filter((c): c is EvidenceArtifact => Boolean(c))
    : [];

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-300",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[400px] flex-col border-l border-outline-variant bg-white shadow-[-8px_0_30px_-10px_rgba(21,27,45,0.12)] transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-label="Artifact details"
      >
        {!artifact ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div className="space-y-2">
              <p className="text-sm font-medium text-on-surface">Select a file to view details</p>
              <p className="text-sm text-on-surface-variant">
                Choose an artifact from the table to inspect metadata, labels, and activity.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-5">
              {/* Header */}
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <ArtifactTypeIcon type={artifact.type} />
                      <h2 className="truncate text-lg font-semibold text-on-surface">
                        {artifact.name}
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                        {formatArtifactType(artifact.type)}
                      </span>
                      <span className="text-sm text-on-surface-variant">
                        {artifact.size ?? "—"}
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="h-9 w-9 shrink-0 rounded-full"
                    aria-label="Close details panel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" className="rounded-xl">
                    <Eye className="h-4 w-4" />
                    Open in viewer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-xl"
                    aria-label="Download artifact"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Tabs */}
              <div>
                <div className="flex border-b border-outline-variant">
                  {(["details", "activity"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors",
                        activeTab === tab
                          ? "border-primary text-primary"
                          : "border-transparent text-on-surface-variant hover:text-on-surface",
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {activeTab === "details" ? (
                  <div className="space-y-5 pt-5">
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-on-surface">About this artifact</h3>
                      <p className="text-sm leading-6 text-on-surface-variant">
                        {artifact.description ??
                          "No description is available for this artifact yet."}
                      </p>
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold text-on-surface">Metadata</h3>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                        <dt className="text-on-surface-variant">Source</dt>
                        <dd className="text-on-surface">{artifact.source}</dd>
                        <dt className="text-on-surface-variant">Created by</dt>
                        <dd className="text-on-surface">System</dd>
                        <dt className="text-on-surface-variant">Created</dt>
                        <dd className="text-on-surface">{formatDateTime(artifact.modifiedAt)}</dd>
                        <dt className="text-on-surface-variant">Modified</dt>
                        <dd className="text-on-surface">{formatDateTime(artifact.modifiedAt)}</dd>
                        <dt className="text-on-surface-variant">Case</dt>
                        <dd className="text-on-surface">Dropbox — AI Workspace Push</dd>
                        <dt className="text-on-surface-variant">Box path</dt>
                        <dd className="break-all font-mono text-xs text-on-surface">
                          {artifact.boxPath ?? "—"}
                        </dd>
                        <dt className="text-on-surface-variant">Digest</dt>
                        <dd className="break-all font-mono text-xs text-on-surface">
                          {artifact.digest ?? "—"}
                        </dd>
                      </dl>
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold text-on-surface">Labels</h3>
                      <div className="flex flex-wrap gap-2">
                        {artifact.labels.length > 0 ? (
                          artifact.labels.map((label) => (
                            <ArtifactLabelBadge key={label} label={label} />
                          ))
                        ) : (
                          <p className="text-sm text-on-surface-variant">No labels assigned.</p>
                        )}
                      </div>
                    </section>

                    <section className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-on-surface">Related evidence</h3>
                        {relatedArtifacts.length > 0 && (
                          <button
                            type="button"
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            View all related
                          </button>
                        )}
                      </div>

                      {relatedArtifacts.length > 0 ? (
                        <div className="space-y-2">
                          {relatedArtifacts.map((related) => (
                            <div
                              key={related.id}
                              className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3"
                            >
                              <ArtifactTypeIcon type={related.type} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-on-surface">
                                  {related.name}
                                </p>
                                <p className="text-xs text-on-surface-variant">
                                  {formatArtifactType(related.type)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-on-surface-variant">
                          No related evidence linked.
                        </p>
                      )}
                    </section>
                  </div>
                ) : (
                  <div className="pt-5">
                    {artifact.activity && artifact.activity.length > 0 ? (
                      <ol className="space-y-4">
                        {artifact.activity.map((entry, index) => (
                          <li key={`${entry.timestamp}-${index}`} className="relative pl-6">
                            {index < artifact.activity!.length - 1 ? (
                              <span className="absolute left-[7px] top-6 h-[calc(100%-0.25rem)] w-px bg-outline-variant" />
                            ) : null}
                            <span className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-primary ring-1 ring-outline-variant" />
                            <p className="text-xs font-medium uppercase tracking-[0.16em] text-on-surface-variant">
                              {entry.timestamp}
                            </p>
                            <p className="mt-1 text-sm text-on-surface">{entry.message}</p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-on-surface-variant">No activity recorded.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
