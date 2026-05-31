# Phase 3 (continued) — Team Vote

> Each team member ranks their top 3 concepts (3 pts / 2 pts / 1 pt) with brief justification.

---

## Voting

| Concept | Kira | Milo | Nova | Sage | Ivy | Remy | **Total** |
|---------|------|------|------|------|-----|------|-----------|
| 1. Always Watching (Scheduled Scans + Drift) | 2 | 1 | 2 | 3 | 1 | 2 | **11** |
| 2. Signal Drop (Slack/Teams) | 1 | — | 3 | — | — | 3 | **7** |
| 3. Trust Score (Confidence Calibration) | — | — | 1 | 2 | 3 | 1 | **7** |
| 4. War Room (Battle Cards) | 3 | 2 | — | — | 2 | — | **7** |
| 5. Evidence Brief (Export) | — | 3 | — | 1 | — | — | **4** |

---

## Justifications

### Kira (Product Designer)
1. **War Room (3 pts)** — This is the feature that makes a sales rep *love* us. It's the "pull up during a call" moment that creates habit and delight. Revenue teams will champion this internally.
2. **Always Watching (2 pts)** — Users shouldn't have to remember to scan. The product should just *work*. This is table stakes for enterprise.
3. **Signal Drop (1 pt)** — Meeting users in Slack is smart distribution. Low effort, high adoption.

### Milo (Art/Visual Director)
1. **Evidence Brief (3 pts)** — A beautiful exported artifact IS the brand. Every time someone shares our output, it's marketing. I want SignalVault to be the brand people recognize from a screenshot in a Slack thread.
2. **War Room (2 pts)** — The battle card UI is a chance to create a signature visual moment. Clean, bold, scannable. This is our hero screen.
3. **Always Watching (1 pt)** — The drift timeline is visually interesting. Scrollable, animated, reveals patterns over time.

### Nova (Frontend Engineer)
1. **Signal Drop (3 pts)** — Best effort-to-impact ratio on this list. I can ship Slack integration in a week. It's a known pattern, minimal new infrastructure, and solves a real distribution problem.
2. **Always Watching (2 pts)** — Adds genuine platform value. The frontend work (schedule config + timeline view) is well-scoped and reusable.
3. **Trust Score (1 pt)** — Thumbs up/down is trivial UI. The dashboard is a nice chart component. Fast win.

### Sage (Backend Engineer)
1. **Always Watching (3 pts)** — This is the foundational infrastructure everything else depends on. Without recurring scans, battle cards go stale, drift detection doesn't exist, and anomaly digests have no data. Build this first.
2. **Trust Score (2 pts)** — Simple schema change, massive signal for prompt improvement. I can ship the backend in a day. No reason not to do this.
3. **Evidence Brief (1 pt)** — The shareable links are interesting from a security angle — expiring URLs, access control on public links. Good problem to solve.

### Ivy (QA Engineer)
1. **Trust Score (3 pts)** — I cannot properly QA AI output without ground truth. This feature gives me a measurement framework. It's also the thing that makes enterprise compliance teams say "yes, we can use this."
2. **War Room (2 pts)** — Clear user journey, testable success criteria ("did the rep find the info they needed in <5 seconds?"). I can write concrete test cases for this.
3. **Always Watching (1 pt)** — Lots of edge cases to test (scheduler failures, Apify rate limits, duplicate scans) but that's exactly what I'm here for. Important to build right.

### Remy (Producer)
1. **Signal Drop (3 pts)** — Ship fast, learn fast. If Slack notifications drive engagement, we double down. If not, we only spent a sprint. This is how you de-risk a product roadmap.
2. **Always Watching (2 pts)** — Sage is right that it's foundational. But I'd scope V1 tightly: weekly cadence only, no drift detection yet. Ship the scheduler, add intelligence later.
3. **Trust Score (1 pt)** — Half-sprint effort for something that compounds over time. No-brainer to ship alongside anything else.

---

## Results (Ranked by Total Points)

| Rank | Concept | Points | Consensus |
|------|---------|--------|-----------|
| 🥇 | Always Watching (Scheduled Scans + Drift) | 11 | Universal support — everyone sees this as foundational |
| 🥈 | Signal Drop (Slack/Teams) | 7 | High ROI, fast ship — Nova and Remy champion |
| 🥈 | Trust Score (Confidence Calibration) | 7 | Low-effort trust builder — Ivy and Sage champion |
| 🥈 | War Room (Battle Cards) | 7 | Revenue driver — Kira and Milo champion |
| 5th | Evidence Brief (Export) | 4 | Milo's passion project — revisit in Sprint N+2 |
