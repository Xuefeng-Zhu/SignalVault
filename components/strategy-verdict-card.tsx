import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Strategy } from "@/lib/schemas";

/**
 * Human-readable labels for each {@link Strategy} prediction value.
 *
 * Requirements: 16.2
 */
export const STRATEGY_LABELS: Record<Strategy, string> = {
  moving_upmarket: "Moving upmarket",
  enterprise_readiness: "Enterprise readiness",
  pricing_tightening: "Pricing tightening",
  security_posture_change: "Security posture change",
  messaging_pivot: "Messaging pivot",
  self_serve_push: "Self-serve push",
  insufficient_evidence: "Insufficient evidence",
};

/** Resolve a strategy enum value to its display label, with a safe fallback. */
export function strategyLabel(strategy: Strategy): string {
  return STRATEGY_LABELS[strategy] ?? "Unknown strategy";
}

/** Clamp an arbitrary number into the inclusive 0–100 confidence range. */
function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(100, Math.max(0, Math.round(confidence)));
}

export interface StrategyVerdictCardProps {
  /** The judge's strategy prediction. */
  strategyPrediction: Strategy;
  /** Confidence value; expected to be an integer in [0, 100] (clamped). */
  confidence: number;
  className?: string;
}

/**
 * Presents a Scan's strategy prediction alongside the judge's confidence
 * value, mapping the {@link Strategy} enum to a human-readable label.
 *
 * Requirements: 16.2
 */
export function StrategyVerdictCard({
  strategyPrediction,
  confidence,
  className,
}: StrategyVerdictCardProps) {
  const label = strategyLabel(strategyPrediction);
  const confidenceValue = clampConfidence(confidence);

  return (
    <Card
      className={cn("w-full", className)}
      data-strategy={strategyPrediction}
    >
      <CardHeader>
        <CardDescription>Strategy prediction</CardDescription>
        <CardTitle className="text-2xl">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {confidenceValue}
          </span>
          <span className="text-sm text-muted-foreground">
            / 100 confidence
          </span>
        </div>
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={confidenceValue}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Verdict confidence"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${confidenceValue}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
