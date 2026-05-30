import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Evidence_Artifact types, aligned with the Box adapter's `ArtifactType`
 * union from the design (raw HTML, normalized markdown, screenshots, diff
 * reports, claim ledgers, and final briefs).
 *
 * Requirements: 17.4
 */
export type ArtifactType =
  | "raw"
  | "normalized"
  | "screenshot"
  | "diff"
  | "claim"
  | "report";

/** Human-readable label for each artifact type. */
export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  raw: "Raw HTML",
  normalized: "Normalized markdown",
  screenshot: "Screenshot",
  diff: "Diff report",
  claim: "Claim ledger",
  report: "Final brief",
};

/**
 * A single Evidence_Artifact entry. `boxUrl` is the artifact's Box storage
 * location (a real web link or a mock link for simulated storage).
 */
export interface EvidenceArtifact {
  type: ArtifactType;
  /** Optional display name (e.g. file name). */
  name?: string;
  /** Box web link to the artifact / its folder. May be a mock link. */
  boxUrl?: string;
  /** Box file identifier (may be a `mock-` identifier). */
  fileId?: string;
  /** Marks the artifact as stored via simulated/mock storage. */
  simulated?: boolean;
}

export interface EvidenceArtifactListProps {
  /** The stored Evidence_Artifacts for the Scan. */
  artifacts: EvidenceArtifact[];
  className?: string;
}

function artifactTypeLabel(type: ArtifactType): string {
  return ARTIFACT_TYPE_LABELS[type] ?? type;
}

/** Render the Box storage location for an artifact (link or plain text). */
function ArtifactLocation({ artifact }: { artifact: EvidenceArtifact }) {
  const location = artifact.boxUrl ?? artifact.fileId;
  if (!location) {
    return (
      <span className="text-sm text-muted-foreground">No location recorded</span>
    );
  }
  if (artifact.boxUrl) {
    return (
      <a
        href={artifact.boxUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        {location}
      </a>
    );
  }
  return <span className="text-sm text-muted-foreground">{location}</span>;
}

/**
 * Lists a Scan's stored Evidence_Artifacts — one entry per artifact, each
 * identifying the artifact's type and its Box storage location. When there are
 * no artifacts, an empty-state message is shown.
 *
 * Requirements: 17.4, 17.5
 */
export function EvidenceArtifactList({
  artifacts,
  className,
}: EvidenceArtifactListProps) {
  if (artifacts.length === 0) {
    return (
      <p
        className={cn("text-sm text-muted-foreground", className)}
        data-empty="true"
      >
        No evidence artifacts are available.
      </p>
    );
  }

  return (
    <ul className={cn("divide-y rounded-lg border", className)}>
      {artifacts.map((artifact, index) => (
        <li
          key={artifact.fileId ?? `${artifact.type}-${index}`}
          className="flex items-center justify-between gap-4 p-3"
          data-artifact-type={artifact.type}
        >
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{artifactTypeLabel(artifact.type)}</Badge>
            {artifact.name ? (
              <span className="text-sm font-medium">{artifact.name}</span>
            ) : null}
            {artifact.simulated ? (
              <span className="text-xs text-muted-foreground">(simulated)</span>
            ) : null}
          </div>
          <ArtifactLocation artifact={artifact} />
        </li>
      ))}
    </ul>
  );
}
