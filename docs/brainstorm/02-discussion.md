# Phase 2 — Discussion & Refinement

> Agents debate, combine, and critique ideas. Genuine disagreements are encouraged.

---

## Round 1: Clustering & First Reactions

**Remy:** Alright, I see three natural clusters emerging:

1. **"Make the output more actionable"** — War Room battle cards, Slack integration, branded reports, API gateway
2. **"Make the data deeper"** — Recurring scans, drift detection, visual diffs, anomaly digest
3. **"Make the platform enterprise-ready"** — Multi-tenant workspaces, permissions, audit trails, confidence calibration

Let's tackle each. Starting with cluster 1 — actionability.

---

## Round 2: Actionability Debate

**Kira:** The War Room and Slack integration are actually complementary. Sales reps need intel *in context* — sometimes that's mid-call (War Room), sometimes it's async in Slack. I'd combine them under one feature: "Competitive Intel Delivery" — push the right insight to the right place at the right time.

**Nova:** I like Slack integration because it's genuinely small scope — it's a webhook with a Block Kit message formatter. Maybe 2-3 days of work. The War Room, though? That's a full new page with real-time data requirements, probably needs caching strategy for sub-second load times during a sales call. Weeks, not days.

**Sage:** Nova's right on scope. But I'd push back on the War Room being *that* hard. We already have all the data — claims, verdicts, confidence scores. The "real-time" part is a misnomer. It's just a well-indexed read view. The hard part is *curation* — deciding which 3-5 bullet points matter for THIS call. That's an AI summarization task.

**Kira:** Exactly, Sage. The magic is in the curation. Nobody wants to read 47 claims during a live call. They want: "Here's the one thing your competitor changed this week that you can use as a talk track." That's an AI prompt engineering problem, not a frontend problem.

**Milo:** And the branded reports — I know you're all going to say "PDF generation is a pain" but hear me out. Enterprise buyers *love* sharing artifacts internally. A beautiful PDF is a growth vector. Their VP sees it, asks "where did this come from?" and now we have a new champion.

**Remy:** Milo, I agree on the growth thesis. But PDF generation is a rabbit hole. Puppeteer, headless Chrome, layout engines — it's a sprint unto itself. Can we scope it to "export as PNG screenshot of the verdict card" as V1?

**Milo:** …Fine. PNG V1, but we come back for the real thing.

**Ivy:** One concern on the API gateway idea — if we expose claims and verdicts externally, what's our data freshness guarantee? If a user's Salesforce integration shows a verdict from 3 months ago and the competitor has since pivoted, that's a liability issue. We need TTL/expiry metadata on every API response.

**Sage:** Good call, Ivy. Every response gets a `last_scanned_at` timestamp and a `stale_after` threshold. If data is stale, the API returns it with a `"freshness": "stale"` flag. Client's problem after that.

---

## Round 3: Data Depth Debate

**Nova:** Recurring scans feel like table stakes. If I'm paying for competitive intelligence, I don't want to manually trigger scans. That should just *happen*. But Sage, what's the backend complexity?

**Sage:** Moderate. We need: a `scan_schedule` table, a cron-like scheduler (Mastra supports this), and idempotency guards so we don't double-scan. The drift detection layer on top is where it gets interesting — we'd need a `claim_history` table that tracks how a specific claim evolves over time. That's a new data model dimension.

**Kira:** Drift detection is where the "Surprise Me" digest gets really powerful. The anomaly isn't just "something changed" — it's "this claim has been stable for 6 months and suddenly shifted." THAT'S the signal enterprise teams care about.

**Milo:** And visually, the heatmap diffs would make the drift *tangible*. Imagine a timeline where you can scrub through 6 months of a competitor's pricing page and see the changes glow. That's a demo moment.

**Nova:** Milo, I love the vision, but storing full-page screenshots for every scan over 6 months? That's a storage and rendering problem. We'd need to be smart about what we capture — maybe just the relevant sections, not full pages.

**Ivy:** Also — **DISAGREEMENT #1** — I'm not convinced visual diffs are reliable enough for enterprise. What happens when the competitor does a full site redesign? Our heatmap shows "everything changed" which is useless noise. Text-based semantic diffs are more resilient to layout changes.

**Milo:** Ivy, the visual diff isn't meant to *replace* the text diff. It's the hook — the "wow" factor. The semantic analysis still happens underneath. The heatmap is communication, not computation.

**Ivy:** Fair, but we need to clearly label it as "visual indicator only" and not imply pixel-level accuracy. Otherwise we'll get bug reports from enterprise legal teams saying "your heatmap missed a change in the footer."

**Remy:** Noted. Visual diffs are a communication layer, not a source of truth. Text diffing remains canonical. Moving on.

---

## Round 4: Enterprise Readiness Debate

**Sage:** Multi-tenant workspaces are non-negotiable for enterprise. Period. Without proper team/role/permission hierarchy, no company with >50 employees will adopt this. InsForge RLS makes this tractable — we just need the data model.

**Nova:** **DISAGREEMENT #2** — I disagree that we need *full* multi-tenant right now. We're pre-product-market-fit. Building an elaborate RBAC system before we have 10 paying customers is over-engineering. Can we do "workspaces with admin/member" as V1 and skip granular per-competitor permissions?

**Sage:** Nova, I hear you on scope, but if we ship workspaces with only admin/member and an enterprise customer asks "can I restrict our junior analysts from seeing the full verdict?" we'll have to refactor the entire permission model. I'd rather do it right once.

**Remy:** Sage, I'm siding with Nova here on timeline. Ship admin/member. If an enterprise customer asks for granular permissions, that's a GREAT problem to have because it means they're paying us. We'll build it then. Don't pre-optimize for a customer we don't have yet.

**Kira:** Sage's confidence calibration idea though — that I think IS urgent. If we can't prove our verdicts are accurate, no one trusts the product. A simple 👍/👎 on each verdict that feeds into a dashboard showing "82% of our verdicts were confirmed accurate" — that's a massive trust signal.

**Ivy:** Yes! And it gives me testable metrics. Right now I can't QA whether the AI output is "good" because there's no ground truth. User feedback creates the ground truth. Ship this early.

**Sage:** I'll also point out — the confidence calibration is maybe 1 day of backend work. A `verdict_feedback` table with `verdict_id`, `user_id`, `rating`, `created_at`. The UI is the harder part.

**Nova:** It's a thumbs up/down button and a simple chart. I can do that in a day too.

**Remy:** So confidence calibration is high-impact, low-effort. Noted. That's going in the final list.

---

## Round 5: What Gets Cut

**Remy:** Alright, reality check. What do we deprioritize?

**Nova:** Real-time collaboration (annotations). It's cool but it's a *massive* infrastructure investment (CRDTs, presence, conflict resolution). We're not a multiplayer app yet. Cut it.

**Kira:** Agreed. Nobody's asking for Google Docs on competitive intelligence. Solve the single-user experience first.

**Milo:** The customizable dashboard widgets — also too early. We don't know what widgets people want yet. Ship fixed views, learn, then make them configurable.

**Ivy:** Scan replay/dry-run — I want it, but it's a nice-to-have. I can test without it. Deprioritize.

**Remy:** Good. So we're converging on: (1) Scheduled scans + drift detection, (2) Slack integration, (3) Confidence calibration, (4) Battle cards / War Room, (5) Branded export. Let's refine these into final pitches.
