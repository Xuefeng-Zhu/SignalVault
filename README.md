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
| Artifact storage | InsForge Storage |
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
│    → normalizeContent → uploadSnapshot               │
│    → diffSnapshots → uploadDiff                      │
│    → extractClaims → classifyClaims                  │
│    → judgeVerdict → uploadBrief                      │
│    → completeScan                                    │
└──────────────────────────────────────────────────────┘
     │              │              │
     ▼              ▼              ▼
┌─────────┐   ┌──────────┐   ┌──────────────┐
│ InsForge│   │   Apify  │   │  InsForge    │
│ (DB/Auth│   │(scraping)│   │  Storage     │
│  /RT)   │   └──────────┘   │ (artifacts)  │
└─────────┘                  └──────────────┘
     │
     ▼
┌──────────────────────┐
│  InsForge AI Gateway │
│  (model inference)   │
└──────────────────────┘
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `INSFORGE_API_URL` | Yes | InsForge project API base URL |
| `INSFORGE_API_KEY` | Yes | InsForge service-role key (server-only) |
| `NEXT_PUBLIC_INSFORGE_API_URL` | Yes | InsForge URL exposed to the browser |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | Yes | InsForge anon key for browser auth |
| `APIFY_TOKEN` | Yes | Apify API token for web scraping |
| `INSFORGE_STORAGE_BUCKET` | Yes | InsForge Storage bucket name for evidence artifacts |
| `MODEL_API_KEY` | Yes | API key for the model inference endpoint |
| `MODEL_BASE_URL` | Yes | Base URL for the model inference endpoint |
| `MODEL_NAME` | No | Model name/ID to use for inference (defaults to provider default) |
| `CREDENTIAL_SECRET` | Yes | Secret key for encrypting stored integration credentials |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Xuefeng-Zhu/SignalVault.git
cd SignalVault
npm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit .env.local with your InsForge + Apify credentials

# 3. Run the dev server
npm run dev

# 4. Open http://localhost:3000
```

---

## Features

- **Company Monitoring** — Add competitors with 3–5 public URLs (pricing, trust, docs, careers, changelog).
- **Automated Scans** — Trigger scans that capture pages via Apify, diff against prior snapshots, and classify changes.
- **Courtroom Verdicts** — AI-powered prosecution/defense/judge framework delivers a strategy prediction with confidence scores.
- **Evidence Vault** — Every capture, diff, and report is stored in InsForge Storage with full audit trail.
- **Claims Ledger** — All classified claims aggregated across companies with risk levels and evidence links.
- **AI Chat** — Ask questions about any monitored company and get model-powered competitive analysis.
- **Auth & Workspaces** — InsForge-backed authentication with workspace isolation via RLS.

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
  api/                  REST endpoints (companies, scans, auth, ai-chat)
  companies/            Company list + detail pages
  scans/                Scan list + detail pages
  claims/               Claims ledger page
  evidence-vault/       Evidence artifact browser
  integrations/         Integration status dashboard
  settings/             Workspace settings
components/             Presentational React components
lib/
  adapters/             Adapter implementations (Apify, InsForge, Model, Storage)
  agents/               Claim extractor + classifier + debate + judge
  auth/                 Auth helpers and workspace resolution
  config/               Env var resolution
  schemas/              Shared Zod schemas
  workflow/             Mastra-based 12-step scan pipeline
    steps/              Individual workflow step modules
tests/                  Cross-cutting property + integration tests
  fixtures/             In-memory test fixtures
```
