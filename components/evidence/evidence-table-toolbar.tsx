"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronDown, LayoutGrid, Search, Upload } from "lucide-react";

export interface EvidenceTableToolbarProps {
  totalFiles: number;
  totalSize: string;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onUploadClick: () => void;
  viewMode: "compact" | "comfortable";
  onViewModeChange: (mode: "compact" | "comfortable") => void;
  showPreview: boolean;
  onTogglePreview: () => void;
}

export function EvidenceTableToolbar({
  totalFiles,
  totalSize,
  searchQuery,
  onSearchChange,
  onUploadClick,
  viewMode,
  onViewModeChange,
  showPreview,
  onTogglePreview,
}: EvidenceTableToolbarProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener("mousedown", handlePointerDown);
    }

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const rangeLabel =
    totalFiles === 0 ? "0 of 0" : `1-${Math.min(25, totalFiles)} of ${totalFiles}`;

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant bg-white px-4 py-3">
      <p className="min-w-0 text-sm text-on-surface-variant">
        <span className="font-medium text-on-surface">{rangeLabel}</span>
        <span> · Total {totalFiles} files · {totalSize}</span>
      </p>

      <div className="flex items-center gap-3">
        <div className="relative w-full min-w-[220px] max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search evidence"
            className="h-9 rounded-xl border-outline-variant bg-surface-container-lowest pl-9"
            aria-label="Search evidence artifacts"
          />
        </div>

        <Button type="button" size="sm" onClick={onUploadClick} className="rounded-xl">
          <Upload className="h-4 w-4" />
          Upload
        </Button>

        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-xl"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <LayoutGrid className="h-4 w-4" />
            View
            <ChevronDown className={cn("h-4 w-4 transition-transform", menuOpen && "rotate-180")} />
          </Button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-outline-variant bg-white p-2 shadow-lg"
            >
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-low",
                  viewMode === "compact" && "bg-primary/5 text-primary"
                )}
                onClick={() => {
                  onViewModeChange("compact");
                  setMenuOpen(false);
                }}
              >
                <span>Compact rows</span>
                <span className="text-xs text-on-surface-variant">
                  {viewMode === "compact" ? "Current" : ""}
                </span>
              </button>

              <button
                type="button"
                className={cn(
                  "mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-low",
                  viewMode === "comfortable" && "bg-primary/5 text-primary"
                )}
                onClick={() => {
                  onViewModeChange("comfortable");
                  setMenuOpen(false);
                }}
              >
                <span>Comfortable rows</span>
                <span className="text-xs text-on-surface-variant">
                  {viewMode === "comfortable" ? "Current" : ""}
                </span>
              </button>

              <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container-low">
                <input
                  type="checkbox"
                  checked={showPreview}
                  onChange={onTogglePreview}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                />
                <span>Show preview panel</span>
              </label>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
