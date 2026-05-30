import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Qualitative risk level derived from a 0–100 risk score.
 */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Inclusive upper bounds for each risk level. A score is "low" through 33,
 * "medium" through 66, and "high" from 67 to 100.
 */
export const RISK_THRESHOLDS = {
  /** scores 0–33 are low risk */
  lowMax: 33,
  /** scores 34–66 are medium risk */
  mediumMax: 66,
} as const;

/** Clamp an arbitrary number into the inclusive 0–100 risk range. */
function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** Map a clamped 0–100 risk score to its qualitative level. */
export function riskLevel(score: number): RiskLevel {
  const value = clampScore(score);
  if (value <= RISK_THRESHOLDS.lowMax) return "low";
  if (value <= RISK_THRESHOLDS.mediumMax) return "medium";
  return "high";
}

const RISK_LEVEL_STYLES: Record<RiskLevel, string> = {
  low: "border-transparent bg-green-100 text-green-800",
  medium: "border-transparent bg-amber-100 text-amber-900",
  high: "border-transparent bg-red-100 text-red-800",
};

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface RiskBadgeProps {
  /** Risk score; expected to be an integer in [0, 100] (clamped defensively). */
  score: number;
  /** Hide the qualitative level suffix (e.g. "· High") when false. */
  showLevel?: boolean;
  className?: string;
}

/**
 * Displays a Scan's risk score (0–100) with a color that reflects its
 * qualitative level: green for low, amber for medium, red for high.
 *
 * Requirements: 16.3
 */
export function RiskBadge({ score, showLevel = true, className }: RiskBadgeProps) {
  const value = clampScore(score);
  const level = riskLevel(value);

  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-semibold", RISK_LEVEL_STYLES[level], className)}
      data-risk-level={level}
      aria-label={`Risk score ${value} out of 100, ${RISK_LEVEL_LABELS[level]} risk`}
    >
      <span>Risk {value}</span>
      {showLevel ? (
        <span className="font-normal opacity-80">· {RISK_LEVEL_LABELS[level]}</span>
      ) : null}
    </Badge>
  );
}
