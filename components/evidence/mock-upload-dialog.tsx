"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MockUploadDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MockUploadDialog({ open, onClose }: MockUploadDialogProps) {
  React.useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-upload-dialog-title"
        className={cn(
          "w-full max-w-md rounded-2xl border border-outline-variant bg-white p-6 shadow-2xl"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <h2 id="mock-upload-dialog-title" className="text-lg font-semibold text-on-surface">
            Demo mode
          </h2>
          <p className="text-sm leading-6 text-on-surface-variant">
            Upload evidence is not implemented in demo mode.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={onClose} className="rounded-xl">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
