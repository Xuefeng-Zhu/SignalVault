import * as React from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The defense's case: the argument that observed changes support a meaningful
 * strategy shift, plus the key evidence cited.
 */
export interface DefenseArgument {
  argument: string;
  keyEvidence?: string[];
}

/**
 * The prosecution's case: the argument that the changes may not prove a shift,
 * plus the counter-evidence cited.
 */
export interface ProsecutionArgument {
  argument: string;
  counterEvidence?: string[];
}

/**
 * The judge's conclusion: the synthesized verdict statement and optional
 * reasoning narrative.
 */
export interface JudgeConclusion {
  conclusion: string;
  reasoning?: string;
}

export interface CourtroomAnalysisProps {
  /** Defense case; omitted from the render when null/undefined. */
  defense?: DefenseArgument | null;
  /** Prosecution case; omitted from the render when null/undefined. */
  prosecution?: ProsecutionArgument | null;
  /** Judge conclusion; omitted from the render when null/undefined. */
  judge?: JudgeConclusion | null;
  className?: string;
}

/** Render a labelled list of evidence strings, or nothing when empty. */
function EvidenceList({
  label,
  items,
}: {
  label: string;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders the courtroom-style strategy analysis: the defense argument, the
 * prosecution argument, and the judge's conclusion.
 *
 * Each part is rendered only when it is available; any unavailable part is
 * omitted entirely without preventing the remaining parts from rendering
 * (graceful partial rendering). When every part is unavailable, an empty-state
 * message is shown.
 *
 * Requirements: 15.4
 */
export function CourtroomAnalysis({
  defense,
  prosecution,
  judge,
  className,
}: CourtroomAnalysisProps) {
  const hasDefense = defense != null && defense.argument.trim().length > 0;
  const hasProsecution =
    prosecution != null && prosecution.argument.trim().length > 0;
  const hasJudge = judge != null && judge.conclusion.trim().length > 0;
  const hasAny = hasDefense || hasProsecution || hasJudge;

  return (
    <section
      className={cn("space-y-4", className)}
      aria-label="Courtroom analysis"
    >
      {!hasAny ? (
        <p className="text-sm text-muted-foreground" data-empty="true">
          No courtroom analysis is available.
        </p>
      ) : null}

      {hasDefense ? (
        <Card data-part="defense">
          <CardHeader>
            <CardTitle className="text-lg">Defense</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{defense!.argument}</p>
            <EvidenceList label="Key evidence" items={defense!.keyEvidence} />
          </CardContent>
        </Card>
      ) : null}

      {hasProsecution ? (
        <Card data-part="prosecution">
          <CardHeader>
            <CardTitle className="text-lg">Prosecution</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{prosecution!.argument}</p>
            <EvidenceList
              label="Counter-evidence"
              items={prosecution!.counterEvidence}
            />
          </CardContent>
        </Card>
      ) : null}

      {hasJudge ? (
        <Card data-part="judge">
          <CardHeader>
            <CardTitle className="text-lg">Judge</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{judge!.conclusion}</p>
            {judge!.reasoning && judge!.reasoning.trim().length > 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {judge!.reasoning}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
