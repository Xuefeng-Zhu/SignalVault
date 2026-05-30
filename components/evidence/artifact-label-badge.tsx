"use client";

import type { RiskLabel } from "@/lib/evidence";
import { cn } from "@/lib/utils";

const LABEL_STYLES: Record<RiskLabel, string> = {
  High: "bg-red-50 text-red-700 border-red-200",
  Medium: "bg-orange-50 text-orange-700 border-orange-200",
  Low: "bg-green-50 text-green-700 border-green-200",
  "Competitive Risk": "bg-purple-50 text-purple-700 border-purple-200",
  "AI Positioning": "bg-blue-50 text-blue-700 border-blue-200",
  Packaging: "bg-amber-50 text-amber-700 border-amber-200",
  Leadership: "bg-indigo-50 text-indigo-700 border-indigo-200",
  Hiring: "bg-cyan-50 text-cyan-700 border-cyan-200",
  Sales: "bg-violet-50 text-violet-700 border-violet-200",
  "Brand Risk": "bg-purple-50 text-purple-700 border-purple-200",
  "Security Risk": "bg-red-50 text-red-700 border-red-200",
};

export interface ArtifactLabelBadgeProps {
  label: RiskLabel;
}

export function ArtifactLabelBadge({ label }: ArtifactLabelBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        LABEL_STYLES[label]
      )}
    >
      {label}
    </span>
  );
}
