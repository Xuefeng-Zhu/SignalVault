# Brainstorm Summary — Product Direction

**Date:** 2025-01-20
**Facilitator:** Remy (Producer)
**Participants:** Kira, Milo, Nova, Sage, Ivy, Remy

---

## Outcome

The team converged on a **3-sprint roadmap** with clear sequencing:

### Sprint N (Next Up): "Always Watching" + "Trust Score"
- **Scheduled Scans** — weekly recurring scans with Mastra cron scheduler (Sage leads)
- **Confidence Calibration** — 👍/👎 feedback on verdicts + calibration dashboard (Nova + Sage co-lead)
- **Rationale:** "Always Watching" is foundational — every other feature depends on fresh, recurring data. "Trust Score" is low-cost and ships alongside as a parallel track.

### Sprint N+1: "Signal Drop" + "War Room"
- **Slack Integration** — webhook-based verdict notifications with Block Kit formatting (Nova leads)
- **Battle Cards** — AI-curated competitive talk tracks for sales reps (Kira designs, Nova builds)
- **Rationale:** Once we have recurring scans generating fresh data, we can *deliver* that data to users via Slack (async) and battle cards (sync). Two delivery mechanisms for the same underlying intelligence.

### Sprint N+2: "Evidence Brief" + Drift Detection v2
- **One-Click Export** — PNG export of verdicts with shareable links (Milo designs, Nova builds)
- **Drift Detection** — Time-series claim tracking, trend visualization, anomaly scoring (Sage leads)
- **Rationale:** By this point we'll have enough historical data from recurring scans to make drift detection meaningful. Export becomes the growth lever.

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Cut real-time collaboration | Too much infra for current stage; solve single-user first |
| Cut customizable dashboards | Don't know what widgets users want yet; ship fixed views, learn |
| Cut full multi-tenant RBAC | Over-engineering for pre-PMF; ship admin/member, iterate when demanded |
| Visual diffs are communication, not source of truth | Text diffing remains canonical; visual is a presentation layer |
| "Always Watching" V1 = weekly only | No custom cadence in V1; add daily/biweekly in V2 |
| Export V1 = PNG, not PDF | Avoid Puppeteer rabbit hole; revisit PDF when demand is proven |

---

## Open Questions (To Resolve Before Sprint Start)

1. **Apify cost model for recurring scans** — do we eat the cost or pass through per-scan credits?
2. **Anomaly threshold tuning** — what "magnitude of change" triggers a notification vs. stays quiet?
3. **Slack OAuth vs. incoming webhooks** — OAuth is better UX but more complex; which for V1?
4. **Battle card curation prompt** — who writes the initial prompt? Kira + Sage pair on this?

---

## Disagreements Logged (For Future Reference)

1. **Ivy vs. Milo on visual diffs** — Ivy concerned about reliability for enterprise legal; Milo sees it as communication layer. Resolved: ship as visual indicator with clear labeling, not source of truth.
2. **Nova vs. Sage on multi-tenant scope** — Nova wants admin/member V1; Sage wants full RBAC. Resolved: ship simple, iterate when enterprise demand materializes. Remy broke the tie toward shipping faster.

---

## Next Action

Remy to create `docs/sprint-N/plan.md` with task breakdown for "Always Watching" + "Trust Score" within 48 hours.
