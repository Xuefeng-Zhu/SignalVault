# Phase 1 — Free Ideation

> **Topic:** What new features or capabilities should SignalVault add next to grow its value proposition and appeal to enterprise revenue/strategy teams?
>
> **Rules:** Wild ideas welcome. No filtering. Each team member pitches 2–3 raw ideas.

---

## Kira (Product Designer)

### 1. "War Room" — Live Competitive Battle Cards
Give sales reps a single screen they can pull up *during a call* that shows real-time competitive positioning. Think: "Your competitor just changed their pricing page 3 days ago — here's exactly what shifted." It should feel like having a coach whispering in your ear, not reading a PDF.

### 2. Competitor Timeline / "Story Mode"
Instead of a flat list of scans, show a *narrative timeline* — "In January they added an enterprise tier, in March they dropped their free plan, in April they hired a new CRO." Make the data feel like a story, not a spreadsheet. Users scroll through it like a news feed.

### 3. "Surprise Me" — Anomaly Digest
A weekly email or push notification that only fires when something *genuinely surprising* happens. No noise — only signal. Users shouldn't have to log in and hunt. The product should come to them with a "Hey, you need to see this."

---

## Milo (Art/Visual Director)

### 1. Visual Diff Heatmaps
Instead of raw text diffs, render a visual overlay of the competitor's actual webpage showing *where* the changes happened — highlighted in our brand orange like a heat map. Screenshot-based. Makes the intelligence feel visceral and immediate. Enterprise buyers eat this up in demos.

### 2. Verdict "Courtroom" Theater UI
Lean into the courtroom metaphor *hard*. When a verdict is rendered, show it like an actual courtroom scene — defense on the left, prosecution on the right, judge at the top. Animate the confidence scores like a scale tipping. Make the moment of truth feel dramatic.

### 3. Branded Intelligence Reports (PDF/Slides)
Let users export a polished, branded report (their logo, their colors) that they can hand to their VP or board. Think: "Our competitive intelligence says X, here's the evidence." Should look like it came from a $50K consulting engagement.

---

## Nova (Frontend Engineer)

### 1. Real-Time Collaboration — Shared Annotations
Let multiple team members annotate claims and verdicts. Like Google Docs comments but on competitive intelligence. Built on presence (think Liveblocks or Yjs). Would make this a team tool rather than a solo analyst tool.

### 2. Dashboard Widgets / Customizable Home Screen
Different users want different views. A sales rep wants battle cards. A product manager wants feature comparisons. A CEO wants market share trends. Let them compose their own dashboard from pre-built widgets. We already have the data — we just need flexible presentation.

### 3. Slack/Teams Integration — Push Verdicts Into Channels
Enterprise teams live in Slack. When a scan completes and finds something noteworthy, auto-post a summary card into a configured channel. Low effort on our side (webhook + formatting), massive UX win for adoption.

---

## Sage (Backend Engineer)

### 1. Multi-Tenant Workspaces with Granular Permissions
Right now we have basic auth. Enterprise wants: "Marketing can see competitors A, B, C. Sales can see all. Legal can see only verdicts flagged as high-confidence." Row-level security is already in our DNA with InsForge — we should formalize workspace/team/role hierarchy.

### 2. Scheduled Recurring Scans with Drift Detection
Instead of one-off scans, let users set a cadence: "Watch this competitor weekly." Then surface *drift over time* — not just "what changed since last scan" but "what's the trajectory over 90 days?" Requires a time-series data model and background job scheduler.

### 3. API Gateway for External Integrations
Expose our verdict + claims data as a first-class REST/GraphQL API. Salesforce admins could pull competitive intelligence directly into opportunity records. BI tools could ingest our data. Turns SignalVault from a product into a platform.

---

## Ivy (QA Engineer)

### 1. Confidence Calibration & Audit Trail
Our AI verdicts have confidence scores, but how calibrated are they? We need a feedback loop — users can mark a verdict as "accurate" or "wrong" and we track precision over time. Without this, enterprise legal teams won't trust the output.

### 2. "What If the Competitor Changes Their Robots.txt?"
We scrape public pages. But what happens when a target blocks us? Graceful degradation: detect 403s/robots.txt changes, notify the user, show last-known state with a stale-data warning. Right now I suspect we'd just silently fail.

### 3. Scan Replay / Dry-Run Mode
Let users preview what a scan *would* do before committing credits. Shows target URLs, estimated time, expected claim types. Reduces surprise bills and builds trust. Also makes my testing life much easier.

---

## Remy (Producer)

Quick temperature check — we have about 15 ideas on the table. Some are small (Slack integration), some are massive (multi-tenant workspaces, API gateway). In Phase 2, let's pressure-test feasibility and stack-rank by impact-to-effort ratio. Moving on.
