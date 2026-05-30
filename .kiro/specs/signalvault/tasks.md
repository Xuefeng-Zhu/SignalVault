# Implementation Plan: SignalVault

## Overview

This plan builds SignalVault as a Next.js 14+ (App Router) + TypeScript application styled with Tailwind CSS 3.4 and shadcn/ui, backed by InsForge (Postgres/auth/realtime via `@insforge/sdk`), orchestrated with Mastra, validated with Zod, and tested with fast-check + Vitest.

The build is sequenced foundation-first: shared Zod schemas, the SSRF guard, the InsForge schema/RLS, and the four adapter interfaces (each with a live and a deterministic demo implementation guarded by `isConfigured()`) come before the Mastra workflow, the analysis agents, the API routes, and the UI. Demo Mode (seeded "Acme AI" with the deterministic 82% "Moving upmarket" verdict) and the degrade-never-crash fallbacks are wired through the adapters so no external failure can crash the app. Property-based tests for the design's 30 correctness properties are placed next to the code they validate; example, component, and integration tests cover the remaining scenarios. Tasks marked `*` are optional test tasks.

## Tasks

- [x] 1. Project scaffolding and tooling
  - [x] 1.1 Scaffold the Next.js App Router project
    - Initialize Next.js 14+ (App Router) with TypeScript strict mode
    - Install and configure Tailwind CSS pinned to 3.4 (do not upgrade to v4) and initialize shadcn/ui
    - Add base dependencies: `@insforge/sdk`, `mastra` (+ `@mastra/core`), `zod`
    - Create directory structure: `app/`, `lib/adapters/`, `lib/schemas/`, `lib/security/`, `lib/workflow/`, `lib/agents/`, `lib/demo/`, `components/`, `tests/`
    - _Requirements: 2.5_
  - [x] 1.2 Configure the Vitest + fast-check test harness
    - Add `vitest`, `fast-check`, `@testing-library/react`, and jsdom; configure `vitest.config.ts` with a `--run` (non-watch) script
    - Set a shared fast-check config of minimum 100 iterations and a `tests/arbitraries/` folder for custom generators
    - _Requirements: 23.5_
  - [x] 1.3 Implement the server-only environment and credential config module
    - Read `DEMO_MODE`, `APIFY_TOKEN`, `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_DEVELOPER_TOKEN`, `INSFORGE_API_URL`, `INSFORGE_API_KEY`, `MODEL_API_KEY`, `MODEL_BASE_URL` in a `server-only` module
    - Expose per-adapter `isConfigured()` inputs and a `resolveRunMode()` helper that maps `DEMO_MODE` + credential presence to a per-adapter `RunMode`
    - _Requirements: 22.1, 22.6, 18.2_

- [x] 2. Shared Zod schemas and domain types
  - [x] 2.1 Define shared enums, Zod schemas, and workflow I/O schemas
    - Implement `SourceTypeEnum`, `ClaimTypeEnum`, `ClaimStatusEnum`, `StrategyEnum`, `ClaimSchema`, `VerdictSchema`
    - Implement `ScanWorkflowInput` and `ScanWorkflowOutput` Zod schemas as the single source of truth
    - _Requirements: 23.2, 23.3, 13.1, 15.3, 16.1_
  - [x] 2.2 Write unit tests for shared schema validation
    - Assert enum membership, bounds (confidence 0–1, integer 0–100), and recommended-actions cardinality 1–10
    - _Requirements: 23.2, 23.3, 16.1_

- [x] 3. SSRF URL guard
  - [x] 3.1 Implement the SSRF URL guard
    - Reject hosts resolving to loopback (127.0.0.0/8, ::1), private IPv4 (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), and unique-local IPv6 (fc00::/7); reject non-HTTP(S) schemes; admit public hosts
    - Return a structured `{ ok, reason }` result for each URL
    - _Requirements: 8.2_
  - [x] 3.2 Write property test for the SSRF guard
    - **Feature: signalvault, Property 7: SSRF guard blocks internal address ranges and admits public hosts**
    - **Validates: Requirements 8.2**

- [x] 4. InsForge database schema and security
  - [x] 4.1 Author migrations for all ten tables
    - Create `workspaces`, `workspace_members`, `companies`, `watched_sources`, `scans`, `snapshots`, `diffs`, `claims`, `verdicts`, `integrations` with the constraints and CHECKs from the design (status enums, change_score 0–100, confidence 0.0–1.0, verdict bounds)
    - Reference users via `auth.users(id)`; default timestamps to `now()`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10_
  - [x] 4.2 Author RLS policies and the scan-status realtime trigger
    - Add RLS policies scoping every domain table to the caller's member workspaces using `auth.uid()`
    - Add a Postgres trigger on `scans.status` that publishes to channel `scan:{scanId}` for realtime updates
    - _Requirements: 1.4, 21.7, 7.3_

- [x] 5. Checkpoint - foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Adapter interfaces and selection factory
  - [x] 6.1 Define adapter interfaces and shared adapter types
    - Implement `Adapter`, `RunMode`, `ApifyClient`/`CaptureRequest`/`CaptureResult`, `BoxClient`/`ArtifactType`/`BoxFolderSet`/`BoxUploadResult`, `InsForgeClient`/`WorkspaceRepository`, `ModelClient`/`InferenceRequest` in `lib/adapters/types.ts`
    - _Requirements: 23.1_
  - [x] 6.2 Implement the demo/live adapter selection factory
    - Build a factory that constructs each adapter's live or demo implementation from `DEMO_MODE` and per-adapter `isConfigured()`, allowing mixed modes within one run
    - _Requirements: 18.1, 18.2, 23.1_

- [x] 7. InsForge adapter and workspace-scoped repository
  - [x] 7.1 Implement the live InsForgeClient and WorkspaceRepository
    - Implement `scoped(workspaceId)` returning repos (companies, scans, snapshots, diffs, claims, verdicts, integrations) where every query is constrained to `workspaceId`; inserts use array form
    - _Requirements: 1.4, 21.7, 20.1_
  - [x] 7.2 Implement the demo in-memory InsForgeClient store
    - In-memory store with the same `WorkspaceRepository` surface, seeded with a default demo Workspace when `DEMO_MODE` is true or InsForge credentials are missing
    - _Requirements: 18.1, 1.6_
  - [x] 7.3 Write property test for workspace scoping
    - **Feature: signalvault, Property 1: Workspace scoping excludes other tenants**
    - **Validates: Requirements 1.4**

- [x] 8. Authentication and active-workspace resolution
  - [x] 8.1 Implement middleware and active-workspace resolution
    - Redirect unauthenticated access to protected routes to the auth flow without rendering scoped content; on auth resolve exactly one active workspace, creating a workspace + owner membership when the user has none; provide a default workspace in Demo Mode
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_
  - [x] 8.2 Write property test for active-workspace resolution
    - **Feature: signalvault, Property 3: Authentication establishes exactly one active workspace**
    - **Validates: Requirements 1.2, 1.3**

- [x] 9. Apify adapter
  - [x] 9.1 Implement the live ApifyClient.capture
    - Run an Apify actor per URL, return raw HTML + screenshot ref within a 60s timeout; defensively re-run the SSRF guard; per-source failures/timeouts mark `ok=false` with `skippedReason`
    - _Requirements: 8.1, 8.7_
  - [x] 9.2 Implement the demo ApifyClient
    - Return seeded snapshot HTML for the Demo_Company sources with `simulated=true`; never make a network call
    - _Requirements: 8.6, 18.1, 19.1_
  - [x] 9.3 Write property test for capture result shape and skips
    - **Feature: signalvault, Property 8: Capture yields one result per source and never throws on skips**
    - **Validates: Requirements 8.3, 8.4, 8.7**
  - [x] 9.4 Write property test for Apify failure fallback
    - **Feature: signalvault, Property 9: Apify failure or missing credentials produces simulated snapshots and continues**
    - **Validates: Requirements 8.6, 19.1**

- [x] 10. Content normalization
  - [x] 10.1 Implement HTML normalization and hashing
    - Convert raw HTML to markdown/text, strip all script/nav/footer elements, compute content hash (raw) and normalized-text hash; fall back to raw text when normalized output is empty after trimming
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 10.2 Write property test for element stripping
    - **Feature: signalvault, Property 10: Normalization removes script, navigation, and footer content**
    - **Validates: Requirements 9.2**
  - [x] 10.3 Write property test for deterministic hashing
    - **Feature: signalvault, Property 11: Content hashing is deterministic**
    - **Validates: Requirements 9.4**

- [x] 11. Box adapter
  - [x] 11.1 Implement the live BoxClient
    - Implement `ensureScanFolders` creating `/SignalVault/{Company}/scans/{timestamp}/{raw,normalized,screenshots,diffs,claims,reports}`, `upload` routing each artifact to its type-matched subfolder, and `folderWebLink`
    - _Requirements: 10.1, 10.2, 10.6_
  - [x] 11.2 Implement the demo/mock BoxClient
    - Return deterministic `mock-` prefixed `fileId`/`folderId`/`url`/`key` with `simulated=true` when uncredentialed/failing
    - _Requirements: 10.5, 19.2_
  - [x] 11.3 Write property test for artifact subfolder routing
    - **Feature: signalvault, Property 12: Box artifacts are routed to the type-matched subfolder**
    - **Validates: Requirements 10.1, 10.2**
  - [x] 11.4 Write property test for Box failure fallback
    - **Feature: signalvault, Property 14: Box failure or missing credentials yields mock identifiers and continues**
    - **Validates: Requirements 10.5, 19.2**

- [x] 12. Diff engine and serialization
  - [x] 12.1 Implement change_score and diff computation
    - Compute `change_score` (integer 0–100, 0 iff identical), `change_summary`, `added_text`, `removed_text`, `modified_sections` from prior/current normalized content
    - _Requirements: 11.2_
  - [x] 12.2 Implement diff serialization and deserialization
    - Implement `serializeDiff`/`deserializeDiff` for the `DiffReportArtifact` and a pure DiffViewer-render function used to define equivalence; throw on malformed input
    - _Requirements: 12.1, 12.2_
  - [x] 12.3 Write property test for change_score bounds
    - **Feature: signalvault, Property 16: change_score is bounded and zero iff content is identical**
    - **Validates: Requirements 11.2**
  - [x] 12.4 Write property test for diff serialization round-trip
    - **Feature: signalvault, Property 17: Diff serialization round-trips**
    - **Validates: Requirements 12.1, 12.2, 12.3**

- [x] 13. Model adapter
  - [x] 13.1 Implement the live ModelClient.complete
    - Route to the OpenAI-compatible endpoint at `MODEL_BASE_URL`/`MODEL_API_KEY` with a fixed precedence preferring the InsForge Model Gateway; enforce a 60s timeout that marks the request failed
    - _Requirements: 24.1, 24.2, 24.4_
  - [x] 13.2 Implement the demo ModelClient
    - Return deterministic seeded analysis text for the Demo_Company with `simulated=true`; never make a network call
    - _Requirements: 24.3, 18.1_
  - [x] 13.3 Write property test for provider precedence
    - **Feature: signalvault, Property 30: Model routing prefers the InsForge Model Gateway**
    - **Validates: Requirements 24.2**

- [x] 14. Demo data seeding (Acme AI)
  - [x] 14.1 Implement the Demo_Company seed and deterministic fallback verdict
    - Seed "Acme AI" with two snapshots (previous/current) over pricing, trust/security, docs, careers; seed claims with statuses reflecting the upmarket story; produce the deterministic verdict ("Moving upmarket", confidence 82) and a reusable deterministic fallback Verdict
    - _Requirements: 18.3, 18.5, 18.6_
  - [x] 14.2 Write property test for demo determinism
    - **Feature: signalvault, Property 27: Demo Mode is deterministic across repeated scans**
    - **Validates: Requirements 18.7**
  - [x] 14.3 Write unit test for the seeded verdict value
    - Assert the demo verdict equals "Moving upmarket" with confidence 82
    - _Requirements: 18.5_

- [x] 15. Checkpoint - adapters and core libraries
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Claim analysis agents
  - [x] 16.1 Implement the claimExtractorAgent
    - Extract typed `Claim[]` over normalized content via `ModelClient`, emitting only claims whose `evidence_text` appears in the normalized content; allow an empty result without failing; reason only over persisted evidence with no side effects
    - _Requirements: 13.1, 13.3, 13.5, 13.6_
  - [x] 16.2 Write property test for typed claim conformance
    - **Feature: signalvault, Property 18: Extracted claims conform to the typed claim schema**
    - **Validates: Requirements 13.1**
  - [x] 16.3 Write property test for claim grounding
    - **Feature: signalvault, Property 19: Extracted claims are grounded in the normalized content**
    - **Validates: Requirements 13.5**
  - [x] 16.4 Implement the claimClassifierAgent
    - Assign exactly one `Claim_Status`; no prior snapshot → `new`; undetermined → `needs_review`; reason only over persisted evidence with no side effects
    - _Requirements: 14.1, 14.2, 14.3_
  - [x] 16.5 Write property test for classification defaults
    - **Feature: signalvault, Property 20: Classification assigns exactly one valid status with defined defaults**
    - **Validates: Requirements 14.1, 14.2, 14.3**

- [x] 17. Courtroom debate agents
  - [x] 17.1 Implement the defenseAgent and prosecutorAgent
    - Defense argues changes support a strategy shift; prosecutor argues they may not, flagging ambiguity/weak signals/missing evidence/copy-refresh; both Zod-validated and side-effect free
    - _Requirements: 15.1, 15.2, 15.5_
  - [x] 17.2 Implement the judgeAgent and deterministic fallback substitution
    - Produce a Zod-validated `Verdict` (strategy enum, confidence 0–100 int, risk 0–100 int, 1–10 actions); emit `insufficient_evidence` with confidence ≤ 25 when no diffs/statuses; on any agent Zod-validation failure substitute the deterministic Demo_Company fallback verdict
    - _Requirements: 15.3, 15.6, 15.7_
  - [x] 17.3 Write property test for verdict bounds and cardinality
    - **Feature: signalvault, Property 21: Judge verdict satisfies all bounds and cardinality**
    - **Validates: Requirements 15.3, 16.1**
  - [x] 17.4 Write property test for the insufficient-evidence rule
    - **Feature: signalvault, Property 22: Absent evidence forces an insufficient-evidence verdict**
    - **Validates: Requirements 15.6**
  - [x] 17.5 Write property test for the fallback verdict on failure
    - **Feature: signalvault, Property 23: Model failure or invalid agent output yields the deterministic fallback verdict**
    - **Validates: Requirements 15.7, 19.3, 24.3**

- [x] 18. Mastra workflow steps and assembly
  - [x] 18.1 Implement createScanStep and planWatchTargetsStep
    - Confirm the scan record/baseline; validate URLs, run the SSRF guard, build the capture plan, and record skipped sources with reasons
    - _Requirements: 23.4, 8.2, 8.3, 8.4_
  - [x] 18.2 Implement runApifyCaptureStep, normalizeArtifactsStep, and uploadSnapshotToBoxStep
    - Capture via `ApifyClient`, create snapshot records, normalize + hash, create Box folders and upload raw/normalized/screenshots, and persist returned Box `fileId`/`folderId`/`url`/`key` (retry persistence ≤ 3, continue on failure)
    - _Requirements: 8.1, 8.5, 9.1, 10.1, 10.2, 10.3, 10.4_
  - [x] 18.3 Write property test for artifact identifier persistence round-trip
    - **Feature: signalvault, Property 13: Uploaded artifact identifiers round-trip to persistence**
    - **Validates: Requirements 10.3**
  - [x] 18.4 Implement findPreviousSnapshotStep and computeDiffStep
    - Select at most one prior snapshot per source from the most recently completed earlier scan; compute and store diffs, serialize the diff report and upload to `diffs/`; record baseline when no prior snapshot exists; continue past per-source diff/serialization failures
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 12.5_
  - [x] 18.5 Write property test for prior snapshot selection
    - **Feature: signalvault, Property 15: Prior snapshot selection picks the most recent earlier completed scan**
    - **Validates: Requirements 11.1**
  - [x] 18.6 Implement extractClaimsStep, classifyClaimsStep, runDebateStep, and writeBriefToBoxStep
    - Run the extractor (upload claim ledger to `claims/`), classifier (persist statuses), defense/prosecutor/judge debate, then render and upload the markdown brief to `reports/`
    - _Requirements: 13.2, 13.4, 14.6, 15.1, 15.2, 15.3, 16.5_
  - [x] 18.7 Implement completeScanStep with persist-before-emit and result aggregation
    - Persist verdict (retry ≤ 3), set status `completed`/`failed`, persist each status before emitting progress, and aggregate `{ data, warnings[], skipped[] }` across steps; on unrecoverable failure set `failed`, retain prior evidence, surface the failing step
    - _Requirements: 7.2, 7.6, 16.1, 16.6, 19.4, 19.5_
  - [x] 18.8 Assemble signalVaultScanWorkflow with Zod I/O validation
    - Wire the twelve steps in order, validate workflow input/output and every step/agent boundary against Zod, halting an affected step on validation failure and surfacing the failing field
    - _Requirements: 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_
  - [x] 18.9 Write property test for status-before-progress ordering
    - **Feature: signalvault, Property 25: Status is persisted before any progress is emitted**
    - **Validates: Requirements 7.2**
  - [x] 18.10 Write property test for schema-gated consumption
    - **Feature: signalvault, Property 29: Schema validation gates step and agent consumption**
    - **Validates: Requirements 23.5, 23.6**
  - [x] 18.11 Write integration test for an end-to-end Demo_Mode scan
    - Run `signalVaultScanWorkflow` for Acme AI and assert it reaches `completed` with the seeded verdict and all evidence artifacts recorded
    - _Requirements: 18.3, 18.5, 18.7_

- [x] 19. Checkpoint - orchestration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. API routes
  - [x] 20.1 Implement POST /api/companies and GET /api/companies
    - Validate name 1–200, valid hostname, 3–5 unique valid http(s) URLs each with a source type; create company + one watched-source per URL atomically in the active workspace; list scoped companies
    - _Requirements: 21.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 20.2 Write property test for dashboard ordering
    - **Feature: signalvault, Property 4: Dashboard ordering is case-insensitive ascending and lossless**
    - **Validates: Requirements 3.1**
  - [x] 20.3 Write property test for valid Add Company creation
    - **Feature: signalvault, Property 5: Valid Add Company creates one company and one source per URL**
    - **Validates: Requirements 4.1, 4.2, 4.7**
  - [x] 20.4 Write property test for atomic rejection of invalid Add Company
    - **Feature: signalvault, Property 6: Invalid Add Company is rejected atomically**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.8**
  - [x] 20.5 Implement GET /api/companies/:id and POST /api/companies/:id/sources
    - Return company + sources + most recent scan/verdict/claims (scope-checked); add a watched source validating http(s) URL + source type
    - _Requirements: 21.2, 5.6, 5.7_
  - [x] 20.6 Implement POST /api/companies/:id/scans
    - Create the scan record with status `queued`/trigger `manual` retrying ≤ 4 total attempts; on success start the workflow and associate workspace + company; on workflow start failure set `failed`
    - _Requirements: 21.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 20.7 Write property test for the scan-creation retry budget
    - **Feature: signalvault, Property 24: Scan creation honors the retry budget**
    - **Validates: Requirements 6.2, 6.3**
  - [x] 20.8 Implement GET /api/scans/:id
    - Return scan status + snapshots + diffs + claims + verdict + Box artifacts, scope-checked to the active workspace
    - _Requirements: 21.5_
  - [x] 20.9 Implement POST /api/integrations/apify and /api/integrations/box
    - Store integration config server-side: encrypt live credentials (persisted value ≠ plaintext) or store a mock placeholder in Demo Mode (≠ any production credential); transmit only placeholders to the browser
    - _Requirements: 21.6, 22.2, 22.3, 22.4, 22.5_
  - [x] 20.10 Write property test for cross-workspace denial
    - **Feature: signalvault, Property 2: Cross-workspace access is denied without leakage or mutation**
    - **Validates: Requirements 1.5, 21.7**
  - [x] 20.11 Write property test for credential non-leakage
    - **Feature: signalvault, Property 28: Credentials never leak to the browser**
    - **Validates: Requirements 22.2, 22.4, 22.5**

- [x] 21. Checkpoint - API
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. UI components
  - [x] 22.1 Implement CompanyCard and RunScanButton
    - CompanyCard shows name, domain, source count, latest scan status/time, verdict + risk, and a not-yet-scanned state; RunScanButton starts a scan and navigates to scan detail
    - _Requirements: 3.2, 3.6, 3.7, 5.4, 6.1, 6.7_
  - [x] 22.2 Implement WatchedSourcesTable and AddCompanyForm
    - Table lists each source's URL + type; form provides 3–5 URL rows with source-type selection and inline validation
    - _Requirements: 5.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 22.3 Implement ScanProgressTimeline with realtime-and-polling
    - Render ordered statuses with labels; subscribe to `scan:{id}` realtime and update within 2s; transparently fall back to polling `GET /api/scans/:id` at an interval ≤ 5s until `completed`/`failed`
    - _Requirements: 7.1, 7.3, 7.4, 7.5_
  - [x] 22.4 Implement DiffViewer, ClaimLedger, and ClaimStatusBadge
    - DiffViewer shows change_summary/added_text/removed_text and a placeholder on deserialize failure; ClaimLedger tabulates claims; ClaimStatusBadge maps statuses to colors
    - _Requirements: 11.4, 12.4, 14.4, 14.5_
  - [x] 22.5 Implement RiskBadge, StrategyVerdictCard, CourtroomAnalysis, EvidenceArtifactList, and BoxEvidenceLink
    - Verdict/risk display; CourtroomAnalysis renders available defense/prosecution/judge parts and omits unavailable ones; EvidenceArtifactList shows one entry per artifact with type + Box location and an empty state; BoxEvidenceLink links to the (possibly mock) folder
    - _Requirements: 16.2, 16.3, 15.4, 17.4, 17.5, 10.6_
  - [x] 22.6 Write component snapshot/unit tests
    - Test ClaimStatusBadge color mapping (14.5), RiskBadge (16.3), StrategyVerdictCard (16.2), DiffViewer (11.4), ClaimLedger (14.4), CourtroomAnalysis partial rendering (15.4), EvidenceArtifactList empty state (17.5), and status-to-label/lifecycle ordering (7.1), CompanyCard not-yet-scanned state (3.7)
    - _Requirements: 14.5, 16.3, 16.2, 11.4, 14.4, 15.4, 17.5, 7.1, 3.7_

- [x] 23. Pages
  - [x] 23.1 Implement the landing page `/`
    - Show product name + tagline (placeholder fallback within 5s), the integration strip in order Apify, Box, Mastra, InsForge, an example brief card, and dashboard navigation; built with Tailwind + shadcn/ui
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 23.2 Write unit test for landing content and integration order
    - Assert the product name, tagline, and the integration strip order Apify, Box, Mastra, InsForge
    - _Requirements: 2.1, 2.6_
  - [x] 23.3 Implement the dashboard `/companies`
    - Render alpha-ordered CompanyCard grid, empty state with add control, add-company navigation, and an error+retry state with no partial/stale cards
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.8_
  - [x] 23.4 Implement the Add Company page `/companies/new`
    - Host AddCompanyForm; on success navigate to the new company detail page
    - _Requirements: 4.1, 4.9_
  - [x] 23.5 Implement the Company detail page `/companies/[id]`
    - Show header, WatchedSourcesTable, scan history (newest first) with empty state, RunScanButton, and latest complete claims/verdict; error+retry on load failure/timeout
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8_
  - [x] 23.6 Implement the Scan detail page `/scans/[id]`
    - Compose ScanProgressTimeline, top region BoxEvidenceLink, middle region watched sources + detected changes, bottom region claims/courtroom/verdict/risk/actions, EvidenceArtifactList, and simulated-adapter warnings; show failure reason on `failed`
    - _Requirements: 7.6, 10.5, 10.6, 17.1, 17.3, 18.2_
  - [x] 23.7 Write property test for partial-results rendering
    - **Feature: signalvault, Property 26: Partial results render available elements and placeholder the rest**
    - **Validates: Requirements 17.2**

- [x] 24. README and documentation
  - [x] 24.1 Write the README with architecture diagram and demo script
    - Document the stack, adapter/demo-mode design, environment variables, an architecture diagram, and a step-by-step demo script for the Acme AI upmarket scenario (deterministic 82% "Moving upmarket" verdict)
    - _Requirements: 18.3, 18.5_

- [x] 25. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks (property, unit, component, integration) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements (granular sub-requirement clauses) for traceability.
- Property-based tests use fast-check + Vitest at a minimum of 100 iterations and are tagged `// Feature: signalvault, Property {n}: {text}`; all 30 design properties are covered exactly once and placed next to the code they validate.
- Adapters are the only door to external services; every adapter has a live and a deterministic demo implementation selected by `DEMO_MODE` + `isConfigured()`, so the demo never makes network calls.
- Checkpoints provide incremental validation at the foundation, adapter, orchestration, API, and final boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "3.1", "4.1", "10.1", "12.1", "23.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2", "6.1", "10.2", "10.3", "12.2", "12.3", "14.1", "22.1", "22.2", "22.5", "23.2"] },
    { "id": 3, "tasks": ["6.2", "7.1", "7.2", "9.1", "9.2", "11.1", "11.2", "13.1", "13.2", "12.4", "14.2", "14.3", "22.4"] },
    { "id": 4, "tasks": ["7.3", "8.1", "9.3", "9.4", "11.3", "11.4", "13.3", "16.1", "16.4", "17.1", "17.2", "18.1", "18.2", "18.4"] },
    { "id": 5, "tasks": ["8.2", "16.2", "16.3", "16.5", "17.3", "17.4", "17.5", "18.3", "18.5", "18.6", "20.1", "20.5", "20.8", "20.9"] },
    { "id": 6, "tasks": ["18.7", "20.2", "20.3", "20.4", "20.10", "20.11", "22.3", "23.3", "23.4", "23.5"] },
    { "id": 7, "tasks": ["18.8", "22.6", "23.6"] },
    { "id": 8, "tasks": ["18.9", "18.10", "18.11", "20.6", "23.7"] },
    { "id": 9, "tasks": ["20.7"] },
    { "id": 10, "tasks": ["24.1"] }
  ]
}
```
