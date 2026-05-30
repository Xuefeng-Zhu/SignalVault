import * as React from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { deserializeDiff, type Diff } from "@/lib/diff";

/** Placeholder shown when a stored diff report artifact cannot be loaded. */
export const DIFF_LOAD_ERROR_MESSAGE = "The diff report could not be loaded.";

export interface DiffViewerProps {
  /**
   * A ready-to-render Diff. Takes precedence over {@link DiffViewerProps.serialized}
   * when both are provided.
   */
  diff?: Diff;
  /**
   * A serialized diff report artifact string to deserialize. When provided and
   * `diff` is not, the component deserializes it with {@link deserializeDiff},
   * falling back to an error placeholder if deserialization throws
   * (Requirement 12.4).
   */
  serialized?: string;
  className?: string;
}

/** A single labelled text block (added/removed text), rendered only when non-empty. */
function TextBlock({
  label,
  text,
  tone,
  dataPart,
}: {
  label: string;
  text: string;
  tone: "added" | "removed";
  dataPart: string;
}) {
  if (text.length === 0) return null;
  return (
    <div data-part={dataPart}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <pre
        className={cn(
          "mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md p-2 text-sm",
          tone === "added"
            ? "bg-green-50 text-green-900"
            : "bg-red-50 text-red-900",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

/**
 * Displays a computed Diff: its change summary, added text, and removed text,
 * plus any modified sections (Requirement 11.4).
 *
 * The component accepts EITHER a ready {@link Diff} object via `diff` OR a
 * serialized diff report artifact string via `serialized`. When only
 * `serialized` is given, deserialization is wrapped in try/catch; if it throws
 * (the artifact is missing or malformed), an error placeholder is rendered
 * instead of crashing, so the rest of the Scan detail page still renders
 * (Requirement 12.4).
 *
 * Requirements: 11.4, 12.4
 */
export function DiffViewer({ diff, serialized, className }: DiffViewerProps) {
  let resolved: Diff | null = diff ?? null;
  let failedToLoad = false;

  if (resolved == null && serialized != null) {
    try {
      resolved = deserializeDiff(serialized);
    } catch {
      failedToLoad = true;
    }
  }

  if (resolved == null) {
    return (
      <Card className={cn("border-destructive/40", className)} data-diff-error="true">
        <CardContent className="pt-6">
          <p className="text-sm text-destructive" role="alert">
            {failedToLoad
              ? DIFF_LOAD_ERROR_MESSAGE
              : "No diff is available for this source."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-diff="true">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span data-part="change-summary">{resolved.changeSummary}</span>
          <span
            className="text-sm font-normal text-muted-foreground"
            data-part="change-score"
          >
            Change {resolved.changeScore}/100
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TextBlock
          label="Added"
          text={resolved.addedText}
          tone="added"
          dataPart="added-text"
        />
        <TextBlock
          label="Removed"
          text={resolved.removedText}
          tone="removed"
          dataPart="removed-text"
        />

        {resolved.modifiedSections.length > 0 ? (
          <div data-part="modified-sections" className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Modified sections
            </p>
            {resolved.modifiedSections.map((section, index) => (
              <div
                key={`${section.heading}-${index}`}
                className="rounded-md border p-3"
                data-section-index={index}
              >
                <p className="text-sm font-medium">{section.heading}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-red-50 p-2 text-sm text-red-900">
                    {section.before}
                  </pre>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-green-50 p-2 text-sm text-green-900">
                    {section.after}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
