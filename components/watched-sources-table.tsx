import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SourceType } from "@/lib/schemas";

/** One Watched_Source row: its public URL and its source-type category. */
export interface WatchedSourceRow {
  url: string;
  sourceType: SourceType;
}

export interface WatchedSourcesTableProps {
  /** Watched_Sources to list, each with a URL and a source-type category. */
  sources: WatchedSourceRow[];
  className?: string;
}

/**
 * Presentational table that lists each Watched_Source with its URL and its
 * source-type category (Requirement 5.1).
 */
export function WatchedSourcesTable({
  sources,
  className,
}: WatchedSourcesTableProps) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No watched sources yet.
      </p>
    );
  }

  return (
    <table
      className={cn("w-full caption-bottom text-sm", className)}
      aria-label="Watched sources"
    >
      <thead className="[&_tr]:border-b">
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="h-10 px-2 font-medium">
            URL
          </th>
          <th scope="col" className="h-10 px-2 font-medium">
            Type
          </th>
        </tr>
      </thead>
      <tbody className="[&_tr:last-child]:border-0">
        {sources.map((source, index) => (
          <tr
            key={`${source.url}-${index}`}
            className="border-b transition-colors hover:bg-muted/50"
          >
            <td className="px-2 py-2 align-middle">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all text-primary underline-offset-4 hover:underline"
              >
                {source.url}
              </a>
            </td>
            <td className="px-2 py-2 align-middle">
              <Badge variant="secondary">{source.sourceType}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
