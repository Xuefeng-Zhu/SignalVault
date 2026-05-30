/**
 * Component unit/snapshot tests (task 22.6).
 *
 * Tests: ClaimStatusBadge, RiskBadge, StrategyVerdictCard, DiffViewer,
 * ClaimLedger, CourtroomAnalysis, EvidenceArtifactList, ScanProgressTimeline,
 * CompanyCard not-yet-scanned state.
 *
 * Requirements: 14.5, 16.3, 16.2, 11.4, 14.4, 15.4, 17.5, 7.1, 3.7
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ClaimStatusBadge,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_STYLES,
} from "@/components/claim-status-badge";
import {
  RiskBadge,
  riskLevel,
  RISK_THRESHOLDS,
} from "@/components/risk-badge";
import {
  StrategyVerdictCard,
  STRATEGY_LABELS,
  strategyLabel,
} from "@/components/strategy-verdict-card";
import {
  DiffViewer,
  DIFF_LOAD_ERROR_MESSAGE,
} from "@/components/diff-viewer";
import { ClaimLedger } from "@/components/claim-ledger";
import { CourtroomAnalysis } from "@/components/courtroom-analysis";
import { EvidenceArtifactList } from "@/components/evidence-artifact-list";
import {
  ScanProgressTimeline,
  SCAN_STATUS_LABELS,
  SCAN_TIMELINE_ORDER,
} from "@/components/scan-progress-timeline";
import { CompanyCard } from "@/components/company-card";
import type { ClaimStatus } from "@/lib/schemas";

/* -------------------------------------------------------------------------- */
/* ClaimStatusBadge (Requirement 14.5)                                        */
/* -------------------------------------------------------------------------- */

describe("ClaimStatusBadge — color mapping (Req 14.5)", () => {
  const statuses: ClaimStatus[] = [
    "new",
    "removed",
    "weakened",
    "contradicted",
    "strengthened",
    "needs_review",
  ];

  it("renders a badge with the correct label for each status", () => {
    for (const status of statuses) {
      const { unmount } = render(<ClaimStatusBadge status={status} />);
      expect(screen.getByText(CLAIM_STATUS_LABELS[status])).toBeInTheDocument();
      unmount();
    }
  });

  it("includes the data-status attribute for each status", () => {
    for (const status of statuses) {
      const { container, unmount } = render(<ClaimStatusBadge status={status} />);
      expect(container.querySelector(`[data-status="${status}"]`)).not.toBeNull();
      unmount();
    }
  });

  it("applies the expected Tailwind color class for new=blue", () => {
    const { container } = render(<ClaimStatusBadge status="new" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("blue");
  });

  it("applies the expected Tailwind color class for contradicted=red", () => {
    const { container } = render(<ClaimStatusBadge status="contradicted" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("red");
  });

  it("CLAIM_STATUS_STYLES covers every status", () => {
    expect(Object.keys(CLAIM_STATUS_STYLES).sort()).toEqual(statuses.sort());
  });
});

/* -------------------------------------------------------------------------- */
/* RiskBadge (Requirement 16.3)                                               */
/* -------------------------------------------------------------------------- */

describe("RiskBadge — score thresholds (Req 16.3)", () => {
  it("renders 'Low' for scores 0–33", () => {
    for (const score of [0, 1, RISK_THRESHOLDS.lowMax]) {
      const { unmount } = render(<RiskBadge score={score} />);
      expect(screen.getByText(/low/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders 'Medium' for scores 34–66", () => {
    for (const score of [RISK_THRESHOLDS.lowMax + 1, 50, RISK_THRESHOLDS.mediumMax]) {
      const { unmount } = render(<RiskBadge score={score} />);
      expect(screen.getByText(/medium/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders 'High' for scores 67–100", () => {
    for (const score of [RISK_THRESHOLDS.mediumMax + 1, 85, 100]) {
      const { unmount } = render(<RiskBadge score={score} />);
      expect(screen.getByText(/high/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("riskLevel helper returns correct level", () => {
    expect(riskLevel(0)).toBe("low");
    expect(riskLevel(33)).toBe("low");
    expect(riskLevel(34)).toBe("medium");
    expect(riskLevel(66)).toBe("medium");
    expect(riskLevel(67)).toBe("high");
    expect(riskLevel(100)).toBe("high");
  });
});

/* -------------------------------------------------------------------------- */
/* StrategyVerdictCard (Requirement 16.2)                                     */
/* -------------------------------------------------------------------------- */

describe("StrategyVerdictCard — strategy and confidence (Req 16.2)", () => {
  it("renders the strategy label for moving_upmarket", () => {
    render(
      <StrategyVerdictCard
        strategyPrediction="moving_upmarket"
        confidence={82}
      />,
    );
    expect(screen.getByText("Moving upmarket")).toBeInTheDocument();
  });

  it("renders the confidence percentage", () => {
    render(
      <StrategyVerdictCard
        strategyPrediction="moving_upmarket"
        confidence={82}
      />,
    );
    expect(screen.getByText(/82/)).toBeInTheDocument();
  });

  it("strategyLabel returns a human-readable label for all strategies", () => {
    const strategies = Object.keys(STRATEGY_LABELS) as Array<
      keyof typeof STRATEGY_LABELS
    >;
    for (const s of strategies) {
      expect(strategyLabel(s)).toBe(STRATEGY_LABELS[s]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* DiffViewer (Requirement 11.4)                                              */
/* -------------------------------------------------------------------------- */

describe("DiffViewer — diff display and error fallback (Req 11.4)", () => {
  it("renders a direct diff object with change_summary", () => {
    render(
      <DiffViewer
        diff={{
          changeScore: 50,
          changeSummary: "Pricing increased significantly",
          addedText: "Enterprise plan added",
          removedText: "Starter plan removed",
          modifiedSections: [],
        }}
      />,
    );
    expect(
      screen.getByText(/pricing increased significantly/i),
    ).toBeInTheDocument();
  });

  it("renders added and removed text blocks", () => {
    render(
      <DiffViewer
        diff={{
          changeScore: 30,
          changeSummary: "Minor changes",
          addedText: "new content here",
          removedText: "old content removed",
          modifiedSections: [],
        }}
      />,
    );
    expect(screen.getByText(/new content here/i)).toBeInTheDocument();
    expect(screen.getByText(/old content removed/i)).toBeInTheDocument();
  });

  it("shows the error placeholder on invalid serialized input (Req 12.4)", () => {
    render(<DiffViewer serialized="not-valid-json-at-all" />);
    expect(screen.getByText(DIFF_LOAD_ERROR_MESSAGE)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* ClaimLedger (Requirement 14.4)                                             */
/* -------------------------------------------------------------------------- */

describe("ClaimLedger — renders claims and empty state (Req 14.4)", () => {
  it("renders an empty state when claims is empty", () => {
    render(<ClaimLedger claims={[]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders rows for each claim", () => {
    render(
      <ClaimLedger
        claims={[
          {
            statementText: "Pricing increased by 20%",
            claimType: "pricing",
            claimStatus: "strengthened",
            confidence: 0.9,
          },
          {
            statementText: "New enterprise tier added",
            claimType: "pricing",
            confidence: 0.8,
          },
        ]}
      />,
    );
    expect(screen.getByText("Pricing increased by 20%")).toBeInTheDocument();
    expect(screen.getByText("New enterprise tier added")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* CourtroomAnalysis (Requirement 15.4)                                       */
/* -------------------------------------------------------------------------- */

describe("CourtroomAnalysis — partial rendering (Req 15.4)", () => {
  it("renders all three sections when provided", () => {
    render(
      <CourtroomAnalysis
        defense={{ argument: "The evidence shows an upmarket shift." }}
        prosecution={{ argument: "The data is ambiguous." }}
        judge={{ conclusion: "Balance of evidence supports the shift." }}
      />,
    );
    expect(
      screen.getByText(/evidence shows an upmarket shift/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/data is ambiguous/i)).toBeInTheDocument();
    expect(
      screen.getByText(/balance of evidence/i),
    ).toBeInTheDocument();
  });

  it("omits defense when not provided", () => {
    const { container } = render(
      <CourtroomAnalysis
        prosecution={{ argument: "No strong evidence." }}
        judge={{ conclusion: "Insufficient data." }}
      />,
    );
    // Should not render a 'defense' heading.
    expect(container.textContent).not.toMatch(/defense/i);
  });

  it("omits prosecution when not provided", () => {
    const { container } = render(
      <CourtroomAnalysis
        defense={{ argument: "Clear signals present." }}
        judge={{ conclusion: "Upmarket confirmed." }}
      />,
    );
    expect(container.textContent).not.toMatch(/prosecution/i);
  });

  it("renders with only judge conclusion provided", () => {
    render(<CourtroomAnalysis judge={{ conclusion: "Verdict reached." }} />);
    expect(screen.getByText(/verdict reached/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* EvidenceArtifactList (Requirement 17.5)                                    */
/* -------------------------------------------------------------------------- */

describe("EvidenceArtifactList — empty state and artifact rendering (Req 17.5)", () => {
  it("renders the empty state when artifacts is empty", () => {
    const { container } = render(<EvidenceArtifactList artifacts={[]} />);
    expect(container.textContent).toMatch(/no evidence artifacts/i);
  });

  it("renders one entry per artifact with type label and Box location", () => {
    render(
      <EvidenceArtifactList
        artifacts={[
          { type: "diff", name: "diff-report.json", boxUrl: "https://box.com/f/1" },
          { type: "report", name: "brief.md", boxUrl: "https://box.com/f/2" },
        ]}
      />,
    );
    // Type labels.
    expect(screen.getByText(/diff report/i)).toBeInTheDocument();
    expect(screen.getByText(/final brief/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* ScanProgressTimeline — status labels and lifecycle ordering (Req 7.1)     */
/* -------------------------------------------------------------------------- */

describe("ScanProgressTimeline — lifecycle ordering (Req 7.1)", () => {
  it("SCAN_STATUS_LABELS covers all 7 statuses", () => {
    const expected = [
      "queued",
      "scraping",
      "uploading",
      "diffing",
      "analyzing",
      "completed",
      "failed",
    ];
    expect(Object.keys(SCAN_STATUS_LABELS).sort()).toEqual(expected.sort());
  });

  it("SCAN_TIMELINE_ORDER is in the correct sequence", () => {
    const expected = [
      "queued",
      "scraping",
      "uploading",
      "diffing",
      "analyzing",
      "completed",
    ];
    expect([...SCAN_TIMELINE_ORDER]).toEqual(expected);
  });

  it("renders the initial status badge", () => {
    render(
      <ScanProgressTimeline
        scanId="test-scan-id"
        initialStatus="queued"
      />,
    );
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("renders completed status correctly", () => {
    render(
      <ScanProgressTimeline
        scanId="test-scan-id"
        initialStatus="completed"
      />,
    );
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* CompanyCard — not-yet-scanned state (Requirement 3.7)                      */
/* -------------------------------------------------------------------------- */

describe("CompanyCard — not-yet-scanned state (Req 3.7)", () => {
  it("shows 'Not yet scanned' when latestScan is null", () => {
    render(
      <CompanyCard
        company={{
          id: "test-id",
          name: "Acme AI",
          domain: "acme.ai",
          sourceCount: 4,
          latestScan: null,
        }}
      />,
    );
    expect(screen.getByText(/not yet scanned/i)).toBeInTheDocument();
  });

  it("renders company name and domain", () => {
    render(
      <CompanyCard
        company={{
          id: "test-id",
          name: "Acme AI",
          domain: "acme.ai",
          sourceCount: 4,
          latestScan: null,
        }}
      />,
    );
    expect(screen.getByText("Acme AI")).toBeInTheDocument();
    expect(screen.getByText("acme.ai")).toBeInTheDocument();
  });
});
