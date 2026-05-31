# Phase 3 — Final Concepts

> 3–5 polished concepts with name, description, pros, cons, and estimated effort.

---

## Concept 1: "Always Watching" — Scheduled Scans + Drift Detection

**Description:**
Users configure a watch cadence per competitor (daily, weekly, biweekly). SignalVault automatically runs scans on schedule and surfaces *drift* — how claims evolve over time, not just what changed since last scan. Includes a "Surprise Me" anomaly digest (email/notification) that fires only when statistically significant changes are detected.

**Key Deliverables:**
- `scan_schedule` table and Mastra-based cron scheduler
- `claim_history` time-series tracking
- Drift scoring algorithm (stability duration × magnitude of change)
- Weekly anomaly digest email (only sends if threshold met)
- UI: schedule configuration per watch target + drift timeline view

**Pros:**
- Transforms product from "tool you use" to "service that works for you"
- Massive retention driver — users get value without logging in
- Enables all downstream features (trend charts, anomaly alerts)
- Aligns with enterprise expectation of continuous monitoring

**Cons:**
- Increases infrastructure cost (background jobs, more Apify credits)
- Needs idempotency and failure recovery for scheduled jobs
- Anomaly thresholding is subjective — too sensitive = noise, too quiet = silence

**Estimated Effort:** 2 sprints (backend scheduling: 1 sprint, drift model + digest: 1 sprint)

---

## Concept 2: "Signal Drop" — Slack/Teams Push Notifications

**Description:**
When a scan finds noteworthy changes (new high-confidence claims, verdict shifts, anomalies), SignalVault posts a formatted summary card into a configured Slack channel or MS Teams webhook. Includes a link back to the full verdict. Users configure which signals matter (severity threshold, competitor filter).

**Key Deliverables:**
- Slack Block Kit message formatter
- MS Teams Adaptive Card formatter
- Notification preferences UI (threshold, channel, competitor filter)
- Webhook registration flow with OAuth for Slack
- Rate limiting to prevent notification fatigue

**Pros:**
- Extremely high ROI — low engineering cost, massive adoption impact
- Meets users where they already are (Slack)
- Acts as a viral growth mechanism (colleagues see cards, ask "what's this?")
- Foundation for future integrations (Salesforce, HubSpot)

**Cons:**
- Slack OAuth adds a small auth complexity
- Risk of "notification blindness" if thresholds aren't tuned well
- MS Teams support is always more painful than expected

**Estimated Effort:** 1 sprint (Slack V1 in first half, Teams stretch goal in second half)

---

## Concept 3: "Trust Score" — Confidence Calibration & Feedback Loop

**Description:**
Add 👍/👎 feedback on every verdict. Track user ratings over time to build a calibration dashboard: "SignalVault verdicts are confirmed accurate X% of the time." Surface per-model and per-claim-type accuracy. Use feedback to improve prompts and flag unreliable claim categories.

**Key Deliverables:**
- `verdict_feedback` table (verdict_id, user_id, rating, optional comment)
- Thumbs up/down UI on verdict cards
- Calibration dashboard (accuracy %, trend over time, breakdown by category)
- Internal prompt improvement pipeline (flag low-accuracy patterns)
- "Confidence badge" on verdicts once we have enough data

**Pros:**
- Low engineering cost, high trust impact
- Creates ground truth for QA and prompt iteration
- Enterprise legal/compliance teams need this to justify acting on AI output
- Virtuous cycle: better feedback → better prompts → better verdicts → more trust

**Cons:**
- Requires user engagement (people must actually click the buttons)
- Cold start problem — no calibration data until users provide feedback
- "Accuracy" is subjective — what counts as a "correct" verdict?

**Estimated Effort:** 0.5 sprints (backend: 1 day, UI: 2 days, dashboard: 2 days)

---

## Concept 4: "War Room" — Sales Battle Cards

**Description:**
A single, focused view designed for sales reps to pull up mid-call. Shows the top 3-5 competitive differentiators, latest changes from the competitor, and suggested talk tracks — all generated from our existing claims and verdicts. AI-curated for brevity. Searchable by competitor and use case.

**Key Deliverables:**
- Battle card generation prompt (AI summarization of claims → talk tracks)
- `/battle-cards/[competitor]` page with sub-second load
- "Copy to clipboard" for individual talk tracks
- Freshness indicator ("based on scan from 2 days ago")
- Optional: CRM-embeddable iframe version

**Pros:**
- Directly ties to revenue — sales teams will pay for this
- Makes SignalVault a daily-use tool rather than quarterly strategy tool
- Leverages existing data with minimal new infrastructure
- Clear differentiation from generic CI tools

**Cons:**
- AI summarization quality must be excellent — bad talk tracks erode trust
- "Top 3-5" curation is opinionated — may miss what matters for specific deals
- Requires recurring scans (Concept 1) to keep data fresh

**Estimated Effort:** 1 sprint (AI prompt work: 3 days, UI: 3-4 days, polish: 2 days)

---

## Concept 5: "Evidence Brief" — One-Click Export

**Description:**
Export any verdict, claim set, or drift timeline as a polished visual artifact (PNG V1, PDF V2). Includes the verdict, key evidence, confidence scores, and sourcing. Designed to be shared internally ("forward this to your VP") or attached to deal notes in CRMs.

**Key Deliverables:**
- Server-side render of verdict card as PNG (html-to-image or Puppeteer)
- Download button on verdict and claim views
- Minimal branding customization (logo upload, V2)
- Shareable link (public, expiring URL via Box)
- PDF export (V2, future sprint)

**Pros:**
- Growth vector — artifacts get shared, new users discover SignalVault
- Low-friction way to prove value to stakeholders who won't log in
- Reuses existing UI components for rendering
- Enterprise buyers love "board-ready" artifacts

**Cons:**
- Server-side rendering adds infrastructure complexity
- PNG is lossy for text-heavy content (accessibility concern)
- Scope creep risk ("can we add our brand colors? custom fonts? 3 more sections?")

**Estimated Effort:** 1 sprint (PNG V1 in first half, shareable links in second half)
