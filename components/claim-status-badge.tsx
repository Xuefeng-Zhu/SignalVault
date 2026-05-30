import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClaimStatus } from "@/lib/schemas";

/**
 * Tailwind color scheme (background + text) for each Claim_Status.
 *
 * The colors are fixed by Requirement 14.5:
 *   new = blue, removed = gray, weakened = orange, contradicted = red,
 *   strengthened = green, needs_review = yellow.
 *
 * Each entry maps the status to a Tailwind `bg-*-100 text-*-800` pair so the
 * rendered badge is queryable by class as well as by the `data-status`
 * attribute on the element.
 */
export const CLAIM_STATUS_STYLES: Record<ClaimStatus, string> = {
  new: "border-transparent bg-blue-100 text-blue-800",
  removed: "border-transparent bg-gray-100 text-gray-800",
  weakened: "border-transparent bg-orange-100 text-orange-800",
  contradicted: "border-transparent bg-red-100 text-red-800",
  strengthened: "border-transparent bg-green-100 text-green-800",
  needs_review: "border-transparent bg-yellow-100 text-yellow-800",
};

/** Human-readable label for each Claim_Status. */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  new: "New",
  removed: "Removed",
  weakened: "Weakened",
  contradicted: "Contradicted",
  strengthened: "Strengthened",
  needs_review: "Needs review",
};

export interface ClaimStatusBadgeProps {
  /** The Claim_Status to render. */
  status: ClaimStatus;
  className?: string;
}

/**
 * Renders a colored badge for a Claim_Status using the exact color mapping
 * required by Requirement 14.5 (new=blue, removed=gray, weakened=orange,
 * contradicted=red, strengthened=green, needs_review=yellow).
 *
 * The raw status is exposed via the `data-status` attribute and the visible
 * label text so the output is queryable in tests.
 *
 * Requirements: 14.5
 */
export function ClaimStatusBadge({ status, className }: ClaimStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("font-semibold", CLAIM_STATUS_STYLES[status], className)}
      data-status={status}
      aria-label={`Claim status: ${CLAIM_STATUS_LABELS[status]}`}
    >
      {CLAIM_STATUS_LABELS[status]}
    </Badge>
  );
}
