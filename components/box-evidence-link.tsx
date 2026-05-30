import * as React from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BoxEvidenceLinkProps {
  /**
   * The Box_Evidence_Folder web link. Works for live Box folders as well as
   * mock/simulated folders (which may use a `mock-` style url).
   */
  url: string;
  /** Marks the link as pointing at simulated/mock storage. */
  simulated?: boolean;
  /** Optional override for the visible link text. */
  label?: string;
  className?: string;
}

/**
 * Links to a Scan's Box_Evidence_Folder. The provided `url` is rendered as-is,
 * so it works for real Box web links and for mock/simulated folders alike.
 *
 * Requirements: 10.6
 */
export function BoxEvidenceLink({
  url,
  simulated = false,
  label,
  className,
}: BoxEvidenceLinkProps) {
  const text = label ?? "View evidence in Box";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
      data-simulated={simulated ? "true" : undefined}
    >
      <span>{text}</span>
      {simulated ? (
        <span className="text-xs font-normal text-muted-foreground">
          (simulated)
        </span>
      ) : null}
    </a>
  );
}
