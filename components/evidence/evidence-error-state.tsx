"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export interface EvidenceErrorStateProps {
  onRetry: () => void;
}

export function EvidenceErrorState({
  onRetry,
}: EvidenceErrorStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50/60 px-6 py-10 text-center"
      )}
      role="alert"
    >
      <div className="mb-4 rounded-full bg-error-container p-3 text-error">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold text-on-surface">Unable to load evidence artifacts</h3>
      <p className="mt-2 max-w-md text-sm text-on-surface-variant">
        There was a problem loading the evidence vault. Please retry the request.
      </p>
      <div className="mt-5 flex items-center gap-3">
        <Button type="button" variant="outline" onClick={onRetry} className="rounded-xl">
          Retry
        </Button>
      </div>
    </div>
  );
}
