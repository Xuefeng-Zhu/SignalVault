"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SearchX } from "lucide-react";

export interface EvidenceEmptyStateProps {
  onClearFilters: () => void;
}

export function EvidenceEmptyState({ onClearFilters }: EvidenceEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant bg-white px-6 py-10 text-center"
      )}
    >
      <div className="mb-4 rounded-full bg-surface-container-low p-3 text-on-surface-variant">
        <SearchX className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold text-on-surface">No evidence artifacts found</h3>
      <p className="mt-2 max-w-sm text-sm text-on-surface-variant">
        Try adjusting your search or filters to find the evidence you need.
      </p>
      <Button type="button" variant="outline" onClick={onClearFilters} className="mt-5 rounded-xl">
        Clear filters
      </Button>
    </div>
  );
}
