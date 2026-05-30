"use client";

import { useCallback, useMemo, useState } from "react";

import {
  EvidenceDetailPanel,
  EvidenceEmptyState,
  EvidenceErrorState,
  EvidenceFilterPanel,
  EvidenceTable,
  EvidenceTableToolbar,
  EvidenceVaultSkeleton,
  MockUploadDialog,
} from "@/components/evidence";
import { MOCK_EVIDENCE_ARTIFACTS } from "@/lib/evidence";
import type { EvidenceArtifact } from "@/lib/evidence";

const DEFAULT_FILTERS = {
  company: "Dropbox",
  source: "all",
  riskLevel: "all",
  artifactType: "all",
  dateRange: "last_30_days",
};

export default function EvidenceVaultPage() {
  const [isLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [artifacts] = useState<EvidenceArtifact[]>(MOCK_EVIDENCE_ARTIFACTS);

  // Filters
  const [company, setCompany] = useState(DEFAULT_FILTERS.company);
  const [source, setSource] = useState(DEFAULT_FILTERS.source);
  const [riskLevel, setRiskLevel] = useState(DEFAULT_FILTERS.riskLevel);
  const [artifactType, setArtifactType] = useState(DEFAULT_FILTERS.artifactType);
  const [dateRange, setDateRange] = useState(DEFAULT_FILTERS.dateRange);

  // Selection
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Table view
  const [viewMode, setViewMode] = useState<"compact" | "comfortable">("comfortable");
  const [showPreview, setShowPreview] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);

  const clearFilters = useCallback(() => {
    setCompany(DEFAULT_FILTERS.company);
    setSource(DEFAULT_FILTERS.source);
    setRiskLevel(DEFAULT_FILTERS.riskLevel);
    setArtifactType(DEFAULT_FILTERS.artifactType);
    setDateRange(DEFAULT_FILTERS.dateRange);
    setSearchQuery("");
  }, []);

  // Apply filters
  const filteredArtifacts = useMemo(() => {
    let result = artifacts;

    if (company !== "all") {
      result = result.filter((a) => a.company === company);
    }
    if (source !== "all") {
      result = result.filter((a) => a.source.toLowerCase().includes(source.toLowerCase()));
    }
    if (riskLevel !== "all") {
      result = result.filter((a) =>
        a.labels.some((l) => l.toLowerCase() === riskLevel.toLowerCase()),
      );
    }
    if (artifactType !== "all") {
      result = result.filter((a) => a.type === artifactType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.type.toLowerCase().includes(q) ||
          a.source.toLowerCase().includes(q) ||
          a.labels.some((l) => l.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [artifacts, company, source, riskLevel, artifactType, searchQuery]);

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedId) ?? null,
    [artifacts, selectedId],
  );

  const handleToggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleCheckAll = useCallback(() => {
    setCheckedIds((prev) => {
      if (prev.size === filteredArtifacts.length) return new Set();
      return new Set(filteredArtifacts.map((a) => a.id));
    });
  }, [filteredArtifacts]);

  if (isLoading) return <EvidenceVaultSkeleton />;

  if (hasError) {
    return (
      <EvidenceErrorState
        onRetry={() => setHasError(false)}
        onUseDemoData={() => setHasError(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
          Evidence Vault
        </h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          Browse Box-backed artifacts, public web captures, diffs, and intelligence reports.
        </p>
      </div>

      {/* Three-column layout */}
      <div className="flex gap-4">
        {/* Left filter panel */}
        <EvidenceFilterPanel
          company={company}
          onCompanyChange={setCompany}
          source={source}
          onSourceChange={setSource}
          riskLevel={riskLevel}
          onRiskLevelChange={setRiskLevel}
          artifactType={artifactType}
          onArtifactTypeChange={setArtifactType}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onClearFilters={clearFilters}
        />

        {/* Center: toolbar + table */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <EvidenceTableToolbar
            totalFiles={filteredArtifacts.length}
            totalSize="30.2 GB"
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onUploadClick={() => setUploadOpen(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showPreview={showPreview}
            onTogglePreview={() => setShowPreview((p) => !p)}
          />

          {filteredArtifacts.length === 0 ? (
            <EvidenceEmptyState onClearFilters={clearFilters} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-outline-variant bg-white">
              <EvidenceTable
                artifacts={filteredArtifacts}
                selectedId={selectedId}
                onSelect={setSelectedId}
                checkedIds={checkedIds}
                onToggleCheck={handleToggleCheck}
                onToggleCheckAll={handleToggleCheckAll}
                viewMode={viewMode}
              />
            </div>
          )}
        </div>

        {/* Right detail panel — drawer overlay */}
        <EvidenceDetailPanel
          artifact={selectedArtifact}
          allArtifacts={artifacts}
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
        />
      </div>

      {/* Upload dialog */}
      <MockUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
