"use client";

import type { ArtifactType } from "@/lib/evidence";
import { cn } from "@/lib/utils";
import {
  Braces,
  Code,
  FileText,
  Folder,
  GitCompare,
  Image,
  Newspaper,
  Scale,
  Table2,
  type LucideIcon,
} from "lucide-react";

const ARTIFACT_TYPE_ICONS: Record<ArtifactType, LucideIcon> = {
  folder: Folder,
  raw_html: Code,
  markdown: FileText,
  screenshot: Image,
  diff: GitCompare,
  claim_ledger: Braces,
  signal_brief: FileText,
  verdict_json: Scale,
  csv_export: Table2,
  public_news: Newspaper,
  report: FileText,
};

const ARTIFACT_TYPE_STYLES: Record<ArtifactType, string> = {
  folder: "text-primary",
  raw_html: "text-orange-500",
  markdown: "text-sky-600",
  screenshot: "text-emerald-500",
  diff: "text-violet-600",
  claim_ledger: "text-fuchsia-600",
  signal_brief: "text-primary",
  verdict_json: "text-amber-700",
  csv_export: "text-teal-600",
  public_news: "text-cyan-700",
  report: "text-slate-600",
};

export interface ArtifactTypeIconProps {
  type: ArtifactType;
  className?: string;
}

export function ArtifactTypeIcon({ type, className }: ArtifactTypeIconProps) {
  const Icon = ARTIFACT_TYPE_ICONS[type];

  return (
    <Icon
      aria-hidden="true"
      className={cn("h-4 w-4 shrink-0", ARTIFACT_TYPE_STYLES[type], className)}
    />
  );
}
