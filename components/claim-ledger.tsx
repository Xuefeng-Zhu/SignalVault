import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { ClaimStatusBadge } from "@/components/claim-status-badge";
import { cn } from "@/lib/utils";
import type { ClaimStatus, ClaimType } from "@/lib/schemas";

/**
 * One row in the ClaimLedger: a classified public Claim with everything the
 * table displays for it (Requirement 14.4).
 *
 * Fields reuse the shared domain vocabularies: `claimType` is a {@link ClaimType}
 * and `claimStatus` is a {@link ClaimStatus}. `claimStatus` is optional because a
 * Claim may not yet have been classified.
 */
export interface ClaimLedgerRow {
  /** The claim's statement text. */
  statementText: string;
  /** The claim's category. */
  claimType: ClaimType;
  /** How the claim changed relative to the prior snapshot, if classified. */
  claimStatus?: ClaimStatus;
  /** Qualitative risk level for the claim (e.g. "low" | "medium" | "high"). */
  riskLevel?: string;
  /** Model confidence in [0, 1]. */
  confidence: number;
  /** The Watched_Source the claim came from. */
  source?: string;
  /** Optional URL for the source, rendered as a link when present. */
  url?: string;
  /** The supporting evidence excerpt from the normalized content. */
  evidenceText: string;
}

export interface ClaimLedgerProps {
  /** The classified claims to tabulate. */
  claims: ClaimLedgerRow[];
  className?: string;
}

/** Format a [0, 1] confidence as a whole-number percentage. */
function formatConfidence(confidence: number): string {
  const value = Number.isFinite(confidence)
    ? Math.min(1, Math.max(0, confidence))
    : 0;
  return `${Math.round(value * 100)}%`;
}

/**
 * Tabulates classified Claims, showing for each claim its statement text, type,
 * Claim_Status (via {@link ClaimStatusBadge}), risk level, confidence value,
 * source, and supporting evidence (Requirement 14.4).
 *
 * Renders an empty state when there are no claims.
 *
 * Requirements: 14.4, 14.5
 */
export function ClaimLedger({ claims, className }: ClaimLedgerProps) {
  if (claims.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        role="status"
        data-empty="true"
      >
        No claims were extracted for this scan.
      </p>
    );
  }

  return (
    <table
      className={cn("w-full caption-bottom text-sm", className)}
      aria-label="Claim ledger"
    >
      <thead className="[&_tr]:border-b">
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="h-10 px-2 font-medium">
            Claim
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Type
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Status
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Risk
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Confidence
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Source
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Evidence
          </th>
        </tr>
      </thead>
      <tbody className="[&_tr:last-child]:border-0">
        {claims.map((claim, index) => (
          <tr
            key={index}
            className="border-b align-top transition-colors hover:bg-muted/50"
          >
            <td className="px-2 py-2" data-field="statement">
              {claim.statementText}
            </td>
            <td className="px-2 py-2" data-field="type">
              <Badge variant="secondary">{claim.claimType}</Badge>
            </td>
            <td className="px-2 py-2" data-field="status">
              {claim.claimStatus ? (
                <ClaimStatusBadge status={claim.claimStatus} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-2 py-2" data-field="risk">
              {claim.riskLevel ?? <span className="text-muted-foreground">—</span>}
            </td>
            <td className="px-2 py-2" data-field="confidence">
              {formatConfidence(claim.confidence)}
            </td>
            <td className="px-2 py-2" data-field="source">
              {claim.url ? (
                <a
                  href={claim.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-primary underline-offset-4 hover:underline"
                >
                  {claim.source ?? claim.url}
                </a>
              ) : (
                claim.source ?? <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-2 py-2 text-muted-foreground" data-field="evidence">
              {claim.evidenceText}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
