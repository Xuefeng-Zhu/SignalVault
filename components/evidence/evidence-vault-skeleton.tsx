"use client";

import { cn } from "@/lib/utils";

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-container-low/60", className)} />;
}

export function EvidenceVaultSkeleton() {
  return (
    <div className="flex gap-6 bg-background">
      <div className="w-[240px] shrink-0 space-y-5 rounded-2xl border border-outline-variant bg-white p-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-10 w-full rounded-xl" />
          </div>
        ))}
        <SkeletonBlock className="h-8 w-24" />
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="rounded-xl border border-outline-variant bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <SkeletonBlock className="h-4 w-48" />
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-9 w-56 rounded-xl" />
              <SkeletonBlock className="h-9 w-24 rounded-xl" />
              <SkeletonBlock className="h-9 w-24 rounded-xl" />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-outline-variant bg-white">
          <div className="border-b border-outline-variant px-3 py-3">
            <SkeletonBlock className="h-4 w-full" />
          </div>
          <div className="space-y-0">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[40px_2fr_1fr_1fr_1.2fr_100px_1.4fr] gap-3 border-b border-outline-variant/50 px-3 py-3">
                <SkeletonBlock className="h-4 w-4 rounded-sm" />
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-4 w-16" />
                <div className="flex gap-2">
                  <SkeletonBlock className="h-5 w-16 rounded-full" />
                  <SkeletonBlock className="h-5 w-14 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-[320px] shrink-0 space-y-5 rounded-2xl border border-outline-variant bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-44" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
          <SkeletonBlock className="h-9 w-9 rounded-full" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-9 w-32 rounded-xl" />
          <SkeletonBlock className="h-9 w-9 rounded-xl" />
        </div>
        <SkeletonBlock className="h-8 w-full" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
