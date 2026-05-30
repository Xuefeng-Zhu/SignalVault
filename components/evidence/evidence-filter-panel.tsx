"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface EvidenceFilterPanelProps {
  company: string;
  onCompanyChange: (v: string) => void;
  source: string;
  onSourceChange: (v: string) => void;
  riskLevel: string;
  onRiskLevelChange: (v: string) => void;
  artifactType: string;
  onArtifactTypeChange: (v: string) => void;
  dateRange: string;
  onDateRangeChange: (v: string) => void;
  onClearFilters: () => void;
}

interface FilterGroupProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

function FilterGroup({ id, label, value, onChange, options }: FilterGroupProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[11px] font-medium uppercase tracking-[0.2em] text-on-surface-variant"
      >
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-10 rounded-xl border-outline-variant bg-surface-container-lowest text-sm text-on-surface",
          "focus-visible:ring-primary"
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function EvidenceFilterPanel({
  company,
  onCompanyChange,
  source,
  onSourceChange,
  riskLevel,
  onRiskLevelChange,
  artifactType,
  onArtifactTypeChange,
  dateRange,
  onDateRangeChange,
  onClearFilters,
}: EvidenceFilterPanelProps) {
  return (
    <aside className="w-[240px] shrink-0 space-y-5 rounded-2xl border border-outline-variant bg-white p-5">
      <FilterGroup
        id="evidence-company-filter"
        label="Company"
        value={company}
        onChange={onCompanyChange}
        options={[
          { value: "all", label: "All companies" },
          { value: "Dropbox", label: "Dropbox" },
          { value: "Acme AI", label: "Acme AI" },
          { value: "Gamma Security", label: "Gamma Security" },
          { value: "DataCloud", label: "DataCloud" },
        ]}
      />

      <FilterGroup
        id="evidence-source-filter"
        label="Source"
        value={source}
        onChange={onSourceChange}
        options={[
          { value: "all", label: "All sources" },
          { value: "Pricing page", label: "Pricing page" },
          { value: "Dash page", label: "Dash page" },
          { value: "Trust center", label: "Trust center" },
          { value: "Careers page", label: "Careers page" },
          { value: "Public news", label: "Public news" },
          { value: "Changelog", label: "Changelog" },
          { value: "Docs", label: "Docs" },
        ]}
      />

      <FilterGroup
        id="evidence-risk-filter"
        label="Label / Risk level"
        value={riskLevel}
        onChange={onRiskLevelChange}
        options={[
          { value: "all", label: "All risk levels" },
          { value: "High", label: "High" },
          { value: "Medium", label: "Medium" },
          { value: "Low", label: "Low" },
          { value: "Brand Risk", label: "Brand risk" },
          { value: "Competitive Risk", label: "Competitive risk" },
          { value: "Security Risk", label: "Security risk" },
        ]}
      />

      <FilterGroup
        id="evidence-type-filter"
        label="Artifact type"
        value={artifactType}
        onChange={onArtifactTypeChange}
        options={[
          { value: "all", label: "All types" },
          { value: "folder", label: "Folder" },
          { value: "raw_html", label: "Raw HTML" },
          { value: "markdown", label: "Markdown" },
          { value: "screenshot", label: "Screenshot" },
          { value: "diff", label: "Diff" },
          { value: "claim_ledger", label: "Claim ledger" },
          { value: "signal_brief", label: "Signal brief" },
          { value: "verdict_json", label: "Verdict JSON" },
          { value: "csv_export", label: "CSV export" },
        ]}
      />

      <FilterGroup
        id="evidence-date-filter"
        label="Date range"
        value={dateRange}
        onChange={onDateRangeChange}
        options={[
          { value: "24h", label: "Last 24 hours" },
          { value: "7d", label: "Last 7 days" },
          { value: "30d", label: "Last 30 days" },
          { value: "90d", label: "Last 90 days" },
          { value: "custom", label: "Custom range" },
        ]}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClearFilters}
        className="h-auto px-0 py-1 text-sm font-medium"
      >
        Clear filters
      </Button>
    </aside>
  );
}
