# SignalVault

> **Turn public web changes into auditable market intelligence.**

SignalVault continuously watches your competitors' public-facing web pages, diffs every change, classifies strategic claims, and delivers a courtroom-style verdict — defense, prosecution, and judge — so revenue and strategy teams can act on facts, not guesses.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router, Server Components) |
| Language | TypeScript 5+ |
| Database / Auth | [InsForge](https://insforge.dev) (Postgres + RLS) |
| Scraping | [Apify](https://apify.com) |
| Artifact storage | [Box](https://box.com) |
| Workflow orchestration | [Mastra](https://mastra.ai) |
| AI model gateway | InsForge / OpenRouter |
| Payments | Stripe (via InsForge) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Testing | Vitest + fast-check (property-based) |

---

## Architecture

```
Browser / CLI
     │
     ▼
┌────────────────────────────────────────────────────┐
│  Next.js App Router (app/)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ /companies   │  │ /scans/[id]  │  │ /api/... │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
└────────────────────────────────────────────────────┘
     │                         │
     │  Server Components       │  API Routes
     ▼                         ▼
┌──────────────────────────────────────────────────────┐
│  lib/workflow  (Mastra-based pipeline)               │
│                                                      │
│  createScan → planWatchTargets → scrapePages         │
│    → normalizeContent → uploadSnapshotToBox          │
│    → diffSnapshots → uploadDiffToBox                 │
│    → extractClaims → classifyClaims                  │
│    → judgeVerdict → uploadBriefToBox                 │
│    → completeScan                                    │
└──────────────────────────────────────────────────────┘
     │              │              │
     ▼              ▼              ▼
┌─────────┐   ┌──────────┐   ┌──────────┐
│ InsForge│   │   Apify  │   │   Box    │
│ (DB/Auth│   │(scraping)│   │(artifacts│
│  /RT)   │   └──────────┘   │ storage) │
└─────────┘                  └──────────┘
     │
     ▼
┌──────────────────────┐
│  InsForge AI Gateway │
│  (model inference)   │
└──────────────────────┘
```

---

## Adapter / Demo Mode Design

SignalVault ships with two adapter modes:

| Mode | Description |
|---|---|
| **`demo`** | All external calls are simulated in-process. No Apify, Box, or live model calls. Data is seeded deterministically from `lib/demo/acme.ts`. |
| **`live`** | Real Apify, Box, and model API calls. Requires credentials (see env vars below). |

The active mode per adapter is resolved by `lib/config/env.ts` → `resolveRunMode()`:

- `DEMO_MODE=true` forces all adapters to demo.
- Otherwise, each adapter falls back to demo when its required credential env vars are absent.

This means you can run the full app UI without any paid-tier API keys.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INSFORGE_API_URL` | Yes | InsForge project API base URL |
| `INSFORGE_API_KEY` | Yes | InsForge service-role key (server-only) |
| `NEXT_PUBLIC_INSFORGE_API_URL` | Yes | InsForge URL exposed to the browser |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | Yes | InsForge anon key for browser auth |
| `DEMO_MODE` | No | Set to `true` to force demo mode for all adapters |
| `APIFY_TOKEN` | Live mode | Apify API token for web scraping |
| `BOX_CLIENT_ID` | Live mode | Box OAuth 2.0 app client ID |
| `BOX_CLIENT_SECRET` | Live mode | Box OAuth 2.0 app client secret |
| `BOX_DEVELOPER_TOKEN` | Live mode | Box developer token (alternative to OAuth) |
| `MODEL_API_KEY` | Live mode | API key for the model inference endpoint |
| `MODEL_BASE_URL` | Live mode | Base URL for the model inference endpoint |
| `MODEL_NAME` | Live mode | Model name/ID to use for inference |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Xuefeng-Zhu/SignalVault.git
cd SignalVault
npm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit .env.local with your InsForge credentials

# 3. Run in demo mode (no external API keys needed)
DEMO_MODE=true npm run dev

# 4. Open http://localhost:3000
```

---

## Demo Script

The demo shows a complete scan lifecycle against a seeded company ("Acme AI") with a pre-computed verdict: **Moving upmarket at 82% confidence**.

1. Navigate to **http://localhost:3000** — the landing page describes the product.
2. Click **Dashboard** → you see the Acme AI company card with a completed scan.
3. Click **Acme AI** → company detail shows watch targets, scan history, claims and verdict.
4. Click **Run Scan** → a new scan is queued; the progress timeline updates in real time.
5. Navigate to **/scans/[new-scan-id]** → the scan detail page shows the full evidence package.

---

## Running Tests

```bash
# All tests (unit + property-based + integration)
npm test

# Watch mode
npm run test:watch

# Type-check only
npx tsc --noEmit
```

---

## Project Structure

```
app/                    Next.js App Router pages and API routes
  api/companies/        REST endpoints (list, create, scan)
  companies/            Company list + detail pages
  scans/[id]/           Scan detail page
components/             Presentational React components
lib/
  adapters/             InsForge + demo adapter implementations
  agents/               Claim extractor + classifier + judge
  config/               Env var resolution + run-mode helpers
  demo/                 Seeded demo data (Acme AI)
  schemas/              Shared Zod schemas
  workflow/             Mastra-based 12-step scan pipeline
    steps/              Individual workflow step modules
tests/                  Cross-cutting property + integration tests
  components/           Component unit tests
```
