# Requirements Document

## Introduction

SignalVault is a full-stack hackathon MVP positioned as a public-web intelligence archive. Its tagline is "Turn public web changes into auditable market intelligence."

Companies continuously change public-facing pages (pricing, docs, changelogs, trust centers, careers, terms, blogs). These changes reveal product strategy, risk posture, market positioning, and shifts in public claims. SignalVault lets a user monitor a company, scrape selected public URLs, store evidence artifacts in Box, compare the current snapshot against the previous snapshot, extract public claims, classify how those claims changed, and generate an AI-authored intelligence brief with a strategy verdict and risk score.

The system integrates four external platforms: Apify for web scraping and snapshotting, Box for governed evidence artifact storage, InsForge for the application backend (Postgres database, authentication, realtime), and Mastra for orchestrating a deterministic AI workflow and a set of analysis agents. Model inference is performed through an OpenAI-compatible provider, preferably the InsForge Model Gateway.

The MVP is optimized for a polished, reliable demo over production completeness. The system MUST remain functional even when external API credentials are missing or external services fail, by falling back to a deterministic Demo Mode built around a seeded company "Acme AI".

## Glossary

- **SignalVault**: The complete full-stack application described by this document.
- **System**: The SignalVault application, including its Next.js frontend, API routes, adapters, and orchestrated workflow, unless a more specific component is named.
- **User**: An authenticated person who monitors companies and runs scans through the SignalVault interface.
- **Workspace**: A tenant boundary that owns companies, scans, and integrations; all data access is scoped to a Workspace.
- **Workspace_Member**: An association record linking a User to a Workspace with a role of owner, admin, or member.
- **Company**: A monitored organization defined by a name, a domain, and a set of Watched_Sources.
- **Watched_Source**: A single public URL belonging to a Company that is eligible to be scraped, categorized by exactly one source type (homepage, pricing, docs, changelog, trust, careers, terms, privacy, status, or blog).
- **Scan**: A single execution that scrapes a Company's Watched_Sources, stores evidence, computes diffs, and produces analysis; it has a lifecycle status.
- **Snapshot**: The captured content (raw HTML, normalized markdown/text, screenshot references) for one Watched_Source at the time of one Scan.
- **Diff**: A computed comparison between a current Snapshot and the previous Snapshot for the same Watched_Source.
- **Claim**: A discrete public statement extracted from a Snapshot's normalized content.
- **Claim_Status**: The classification of how a Claim changed between snapshots; one of new, removed, weakened, contradicted, strengthened, needs_review.
- **Verdict**: The synthesized strategy conclusion for a Scan, including a strategy prediction, a confidence value, a risk score, and recommended actions.
- **Evidence_Artifact**: A file stored in Box (raw HTML, normalized markdown, screenshot, claim ledger, diff report, or final brief) associated with a Scan.
- **Box_Evidence_Folder**: The Box folder hierarchy that contains a Scan's Evidence_Artifacts.
- **Integration**: A stored configuration record for an external provider (Apify or Box), including credential references.
- **Mastra_Workflow**: The orchestrated, deterministic sequence of steps named `signalVaultScanWorkflow` that executes a Scan.
- **Analysis_Agent**: A Mastra agent (claimExtractorAgent, claimClassifierAgent, defenseAgent, prosecutorAgent, judgeAgent) that reasons over collected evidence and produces typed output.
- **Apify_Adapter**: The `ApifyClient` adapter interface that performs scraping or returns mock results.
- **Box_Adapter**: The `BoxClient` adapter interface that stores Evidence_Artifacts or returns mock storage results.
- **InsForge_Adapter**: The `InsForgeClient` adapter interface for database, authentication, and realtime operations.
- **Model_Adapter**: The `ModelClient` adapter interface for OpenAI-compatible model inference.
- **Demo_Mode**: An operating mode, enabled when `DEMO_MODE` is true or when required credentials are missing, in which the System produces deterministic seeded results instead of calling external services.
- **Demo_Company**: The seeded company "Acme AI" used in Demo_Mode, with two seeded snapshots demonstrating an upmarket strategy shift.
- **SSRF**: Server-Side Request Forgery; an attack where a server is induced to make requests to unintended internal destinations.

## Requirements

### Requirement 1: User Authentication and Workspace Scoping

**User Story:** As a User, I want to sign in and operate within my own workspace, so that my monitored companies and evidence remain isolated from other tenants.

#### Acceptance Criteria

1. WHEN an unauthenticated User requests a protected page, THE System SHALL redirect the User to the authentication flow without rendering any protected-page content and without returning any Workspace-scoped data.
2. WHEN a User successfully authenticates AND the User has at least one Workspace_Member record, THE System SHALL establish a session and set exactly one of the User's member Workspaces as the active Workspace for that session.
3. IF a User successfully authenticates but has no associated Workspace_Member record, THEN THE System SHALL create a Workspace and a corresponding Workspace_Member record for that User and set the created Workspace as the active Workspace, so that the session always has exactly one active Workspace.
4. THE System SHALL restrict every database query for companies, scans, snapshots, diffs, claims, and verdicts to records whose Workspace identifier equals the active Workspace identifier, and SHALL exclude from results every record belonging to any other Workspace.
5. IF a User requests a resource that belongs to a Workspace the User is not a member of, THEN THE System SHALL deny the request, return an authorization error indicating the User is not permitted to access the resource, return no attributes of the requested resource, and leave the requested resource and all Workspace data unchanged.
6. WHERE Demo_Mode is active, THE System SHALL provide a single default Workspace and set it as the active Workspace so that the demo flow proceeds without external authentication.
7. IF Demo_Mode cannot provide a default Workspace, THEN THE System SHALL fall back to the authentication flow defined for unauthenticated Users.

### Requirement 2: Landing Page

**User Story:** As a visitor, I want a landing page that explains SignalVault, so that I understand the product before signing in.

#### Acceptance Criteria

1. WHEN a visitor opens the root route, THE System SHALL display, without requiring authentication, the product name "SignalVault" and the tagline "Turn public web changes into auditable market intelligence."
2. IF the product name or tagline does not render within 5 seconds of the root route loading, THEN THE System SHALL display placeholder text in place of each element that did not render and SHALL continue to render the remaining landing page elements.
3. THE System SHALL display a navigation control on the landing page that leads to the dashboard.
4. WHEN a visitor activates the landing page navigation control, THE System SHALL route the visitor to the dashboard route.
5. THE System SHALL render the landing page using Tailwind CSS and shadcn/ui components.
6. THE System SHALL display on the landing page an architecture strip showing the four integration platforms in the order Apify, Box, Mastra, InsForge.
7. THE System SHALL display on the landing page an example output card that previews a sample intelligence brief, including a strategy prediction and a risk score.

### Requirement 3: Dashboard of Monitored Companies

**User Story:** As a User, I want a dashboard listing my monitored companies, so that I can review and access them quickly.

#### Acceptance Criteria

1. WHEN a User opens the dashboard route, THE System SHALL display every Company belonging to the active Workspace as a CompanyCard, ordered alphabetically by Company name (case-insensitive, ascending).
2. THE System SHALL display, for each CompanyCard, the Company name, the Company domain, the count of Watched_Sources, and the status and start time of the Company's most recent Scan.
3. WHEN a User selects a CompanyCard, THE System SHALL navigate to the corresponding Company detail page.
4. WHERE the active Workspace contains zero companies, THE System SHALL display an empty-state message and a control to add a Company, regardless of whether companies previously existed.
5. THE System SHALL provide a navigation control on the dashboard that routes the User to the Add Company page.
6. WHEN the most recent Scan for a Company has a Verdict, THE System SHALL display that Verdict's strategy prediction and risk score on the Company's CompanyCard.
7. WHERE a Company has no Scan, THE System SHALL display a not-yet-scanned indication on its CompanyCard in place of the scan status, last scan time, strategy prediction, and risk score.
8. IF the dashboard fails to load the Companies of the active Workspace, THEN THE System SHALL display an error message and a control to retry loading, and SHALL NOT display partial or stale CompanyCards.

### Requirement 4: Add a Monitored Company

**User Story:** As a User, I want to add a company with its public URLs, so that SignalVault can monitor those pages.

#### Acceptance Criteria

1. WHEN a User submits the Add Company form with a name of 1 to 200 characters, a domain that is a syntactically valid hostname, and between 3 and 5 public URLs that are each assigned a source type, THE System SHALL create one Company record and one Watched_Source record per submitted URL in the active Workspace.
2. THE System SHALL require each Watched_Source to be categorized as exactly one of the following source types: homepage, pricing, docs, changelog, trust, careers, terms, privacy, status, blog.
3. IF a User submits the Add Company form with fewer than 3 URLs or more than 5 URLs, THEN THE System SHALL reject the submission, create no Company or Watched_Source records, and display a validation message stating that between 3 and 5 URLs are allowed.
4. IF a User submits a URL that is not a syntactically valid HTTP or HTTPS URL, THEN THE System SHALL reject the submission, create no Company or Watched_Source records, and display a validation message identifying the invalid URL.
5. IF a User submits the Add Company form with an empty name, a name longer than 200 characters, or a domain that is not a syntactically valid hostname, THEN THE System SHALL reject the submission, create no Company or Watched_Source records, and display a validation message identifying the invalid field.
6. IF a User submits the Add Company form containing two or more identical URLs, THEN THE System SHALL reject the submission, create no Company or Watched_Source records, and display a validation message identifying the duplicate URL.
7. THE System SHALL create Watched_Source records only when the associated Company record is created successfully.
8. IF creation of the Company record or any of its Watched_Source records fails before all records are persisted, THEN THE System SHALL persist no Company or Watched_Source records and display an error message indicating that the company could not be created.
9. WHEN a Company is created successfully, THE System SHALL navigate the User to the Company detail page for the new Company.

### Requirement 5: Company Detail View

**User Story:** As a User, I want to view a company's watched sources and scan history, so that I can manage monitoring and start new scans.

#### Acceptance Criteria

1. WHEN a User opens a Company detail page, THE System SHALL display the Company name, the Company domain, and a WatchedSourcesTable listing each Watched_Source with its URL and its source-type category.
2. WHEN a User opens a Company detail page, THE System SHALL display the Company's Scan history as a list ordered from most recent to oldest by Scan creation time, showing each Scan's current status and creation timestamp.
3. WHERE the Company has zero Scans, THE System SHALL display an empty-state message indicating that no scans exist for the Company.
4. WHEN a User opens a Company detail page, THE System SHALL display a RunScanButton.
5. WHERE the Company has at least one Scan in the Complete status, THE System SHALL display, on the Company detail page, the Claims and the Verdict strategy prediction from the most recent Complete Scan.
6. WHEN a User adds a Watched_Source with a syntactically valid HTTP or HTTPS URL and a source-type category to an existing Company, THE System SHALL persist the new Watched_Source in the active Workspace and display it in the WatchedSourcesTable.
7. IF a User adds a Watched_Source whose URL is not a syntactically valid HTTP or HTTPS URL, THEN THE System SHALL reject the addition, create no Watched_Source record, and display a validation message identifying the invalid URL.
8. IF the Company detail information fails to load or does not complete loading within 10 seconds, THEN THE System SHALL display an error message indicating the load failure and a control that re-attempts loading the Company detail information.

### Requirement 6: Initiate a Scan

**User Story:** As a User, I want to start a scan for a company, so that SignalVault captures current evidence and analyzes changes.

#### Acceptance Criteria

1. WHEN a User activates the RunScanButton for a Company, THE System SHALL create a Scan record in the InsForge database with status "queued" and trigger_type "manual".
2. IF creating the Scan record fails, THEN THE System SHALL retry creating the Scan record up to 3 additional times, for a maximum of 4 attempts in total, before reporting failure.
3. IF all 4 attempts to create the Scan record fail, THEN THE System SHALL persist no Scan record, start no Mastra_Workflow for that activation, and display an error message indicating that the Scan could not be started.
4. WHEN a Scan record is created, THE System SHALL start the Mastra_Workflow `signalVaultScanWorkflow` for that Scan.
5. IF starting the Mastra_Workflow `signalVaultScanWorkflow` fails after the Scan record is created, THEN THE System SHALL set the Scan status to a failed state and display an error message indicating that the Scan could not start.
6. THE System SHALL associate every created Scan with the active Workspace and the target Company.
7. WHEN a Scan is created successfully, THE System SHALL navigate the User to the Scan detail page for that Scan.

### Requirement 7: Scan Lifecycle and Live Progress

**User Story:** As a User, I want to see live progress while a scan runs, so that I understand what the system is doing.

#### Acceptance Criteria

1. THE System SHALL represent in-progress Scan lifecycle using the ordered status values queued, scraping, uploading, diffing, analyzing, and completed, and SHALL represent an unrecoverable Scan using the terminal status failed, presenting these on the ScanProgressTimeline with the labels Queued, Scraping, Uploading to Box, Diffing, Analyzing, Complete, and Failed respectively.
2. WHEN the Mastra_Workflow transitions a Scan to a new status, THE System SHALL persist the updated status to the Scan record before emitting any progress update.
3. WHILE a Scan has a status other than completed or failed, THE System SHALL update the ScanProgressTimeline on the Scan detail page to reflect the Scan's current persisted status within 2 seconds of that status being persisted, using InsForge realtime updates.
4. IF the InsForge realtime channel for a running Scan is unavailable, THEN THE System SHALL poll the Scan record at an interval not exceeding 5 seconds and update the ScanProgressTimeline so that progress display continues without requiring a manual page reload.
5. WHEN a Scan reaches the completed status, THE System SHALL display the completed scan results on the Scan detail page within 2 seconds of the completed status being persisted.
6. IF a Scan step fails and recovery is not possible, THEN THE System SHALL set the Scan status to failed, retain all Snapshot and Evidence_Artifact data collected before the failure, and display on the Scan detail page a failure reason identifying which workflow step failed.

### Requirement 8: Apify Scraping and Snapshot Capture

**User Story:** As a User, I want the system to scrape my watched sources, so that current page content is captured as evidence.

#### Acceptance Criteria

1. WHEN the Mastra_Workflow reaches the capture step, THE Apify_Adapter SHALL scrape each valid Watched_Source of the Company and SHALL return the raw HTML and a screenshot reference for each Watched_Source that is successfully scraped within 60 seconds.
2. THE System SHALL validate each Watched_Source URL before scraping and SHALL reject any URL whose host resolves to a loopback address (127.0.0.0/8 or ::1), a private IPv4 range (10.0.0.0/8, 172.16.0.0/12, or 192.168.0.0/16), a link-local range (169.254.0.0/16 or fe80::/10), or a unique local IPv6 range (fc00::/7) to prevent SSRF.
3. IF a Watched_Source URL is rejected by validation, THEN THE System SHALL skip scraping that Watched_Source, record the rejection reason, and continue scraping the remaining valid Watched_Sources.
4. WHEN the capture step finishes with one or more skipped Watched_Sources, THE System SHALL complete the capture step with partial results and display a warning identifying each skipped Watched_Source and the reason it was skipped.
5. WHEN a Watched_Source is successfully scraped, THE System SHALL create a Snapshot record for that Watched_Source associated with the current Scan.
6. IF the Apify_Adapter cannot complete scraping because Apify credentials are missing or the Apify call fails, THEN THE System SHALL produce demo snapshot data for the affected Watched_Sources and display a warning indicating that scraped results are simulated.
7. IF scraping an individual Watched_Source fails or does not return both raw HTML and a screenshot reference within 60 seconds, THEN THE System SHALL skip that Watched_Source, record the failure reason, and continue scraping the remaining Watched_Sources.

### Requirement 9: Content Normalization

**User Story:** As a User, I want captured HTML normalized to readable text, so that diffs and claim extraction operate on clean content.

#### Acceptance Criteria

1. WHEN a Snapshot's raw HTML is captured, THE System SHALL normalize the raw HTML into either markdown or plain text and store the resulting normalized content with the Snapshot record.
2. WHEN the System normalizes a Snapshot's raw HTML, THE System SHALL remove all script, navigation, and footer elements that are present so that they are excluded from the normalized content.
3. THE System SHALL preserve, for each Snapshot, both the raw HTML artifact and the normalized markdown artifact.
4. WHEN a Snapshot's normalized content is produced, THE System SHALL compute and store a content hash derived from the raw HTML and a normalized text hash derived from the normalized content for that Snapshot.
5. IF normalization of a Snapshot's raw HTML fails or produces normalized content of zero characters after trimming leading and trailing whitespace, THEN THE System SHALL store the unmodified raw text as the normalized content, record the normalization failure reason, and continue normalizing the remaining Snapshots.

### Requirement 10: Box Evidence Storage

**User Story:** As a User, I want evidence stored in Box with a governed folder structure, so that the analysis is auditable.

#### Acceptance Criteria

1. WHEN the Mastra_Workflow reaches the Box upload step, THE Box_Adapter SHALL create the folder hierarchy `/SignalVault/{Company}/scans/{timestamp}/`, where `{timestamp}` is a value that uniquely identifies the Scan, containing exactly the six subfolders named raw, normalized, screenshots, diffs, claims, and reports.
2. WHEN the Box_Adapter uploads an Evidence_Artifact, THE Box_Adapter SHALL place the artifact in the subfolder matching its artifact type, mapping raw HTML to raw, normalized markdown to normalized, screenshots to screenshots, diff reports to diffs, claim ledgers to claims, and final briefs to reports.
3. WHEN an Evidence_Artifact is uploaded, THE System SHALL persist the returned Box file identifier and Box folder identifier with the corresponding Evidence_Artifact record in the InsForge database.
4. IF persisting a returned Box file identifier or Box folder identifier to the InsForge database fails, THEN THE System SHALL retry the persistence up to 3 times and, if all attempts fail, record the failure cause and continue the Mastra_Workflow without terminating the Scan.
5. IF the Box_Adapter cannot complete storage because Box credentials are missing or the Box call fails, THEN THE System SHALL record mock storage identifiers for the affected Evidence_Artifacts, continue the Mastra_Workflow, and display a warning on the Scan detail page indicating that evidence storage is simulated.
6. WHEN a User opens the Scan detail page, THE System SHALL display a BoxEvidenceLink that points to the Box_Evidence_Folder for the Scan, including when that folder is represented by mock storage identifiers.

### Requirement 11: Snapshot Comparison and Diffing

**User Story:** As a User, I want the current snapshot compared against the previous one, so that I can see what changed.

#### Acceptance Criteria

1. WHEN the Mastra_Workflow reaches the diff step, THE System SHALL identify, for each Watched_Source within the same Company, the prior Snapshot captured by the most recently completed earlier Scan, selecting at most one prior Snapshot per Watched_Source.
2. WHEN a prior Snapshot exists for a Watched_Source, THE System SHALL compute a Diff between the prior normalized content and the current normalized content and store a Diff record containing a change_score that is an integer from 0 to 100 inclusive (where 0 indicates the prior and current normalized content are identical and 100 indicates maximal change), a change_summary, added_text, removed_text, and modified_sections.
3. IF no prior Snapshot exists for a Watched_Source, THEN THE System SHALL record the current Snapshot as an initial baseline and mark the Watched_Source as having no comparison available.
4. WHEN one or more Diffs have been computed for a Scan, THE System SHALL display each computed Diff on the Scan detail page in a DiffViewer, showing the change_summary, the added_text, and the removed_text for that Diff.
5. THE System SHALL store a diff report Evidence_Artifact for the Scan in the Box diffs subfolder.
6. IF computing a Diff for a Watched_Source fails, THEN THE System SHALL record the failure cause, exclude that Watched_Source from the stored Diff records, and continue computing Diffs for the remaining Watched_Sources.

### Requirement 12: Diff Report Serialization

**User Story:** As a User, I want diff reports stored and re-loaded reliably, so that evidence remains consistent when reviewed later.

#### Acceptance Criteria

1. WHEN the System computes a Diff during a Scan, THE System SHALL serialize that Diff into a structured diff report artifact that captures the Diff's compared prior Snapshot reference, current Snapshot reference, and all detected change content.
2. WHEN the System loads a stored diff report artifact to display a Diff on the Scan detail page, THE System SHALL deserialize that artifact into a Diff representation for the DiffViewer.
3. WHEN the System serializes any computed Diff and then deserializes the resulting diff report artifact, THE System SHALL produce a Diff representation equivalent to the original Diff, where equivalence means the deserialized Diff references the same prior Snapshot and current Snapshot, contains the same set of detected changes, and renders identical content in the DiffViewer as the original Diff (round-trip property).
4. IF a stored diff report artifact cannot be deserialized because it is missing or malformed, THEN THE System SHALL display an error message indicating that the diff report could not be loaded and SHALL render the remaining Scan detail page elements without the affected Diff.
5. IF the System cannot serialize a computed Diff, THEN THE System SHALL record the failure cause and continue the Scan without terminating the workflow, omitting the diff report artifact for that Diff.

### Requirement 13: Public Claim Extraction

**User Story:** As a User, I want public claims extracted from each snapshot, so that I can track how a company's public statements evolve.

#### Acceptance Criteria

1. WHEN the Mastra_Workflow reaches the claim extraction step, THE claimExtractorAgent SHALL extract discrete public Claims from the normalized content of each Snapshot and return them in the typed output schema, where each Claim includes a claim_type that is exactly one of pricing, packaging, security, compliance, feature, integration, social_proof, hiring, terms, or positioning, an evidence_text, and a confidence value between 0.0 and 1.0 inclusive.
2. THE System SHALL persist each extracted Claim associated with its Snapshot and Scan.
3. THE claimExtractorAgent SHALL reason only over evidence collected by the deterministic workflow steps and SHALL NOT perform external side effects.
4. THE System SHALL store a claim ledger Evidence_Artifact for the Scan in the Box claims subfolder.
5. THE claimExtractorAgent SHALL extract only Claims whose evidence_text is present in the Snapshot's normalized content, and SHALL NOT emit any Claim that is not directly supported by that normalized content.
6. IF a Snapshot's normalized content contains no public Claim supported by that content, THEN THE claimExtractorAgent SHALL return an empty Claim collection for that Snapshot in the typed output schema and SHALL NOT fail the claim extraction step.

### Requirement 14: Claim Change Classification

**User Story:** As a User, I want each claim change classified, so that I can quickly see the nature of each change.

#### Acceptance Criteria

1. WHEN the Mastra_Workflow reaches the classification step, THE claimClassifierAgent SHALL assign each Claim that has a prior Snapshot available for comparison exactly one Claim_Status from the set new, removed, weakened, contradicted, strengthened, or needs_review.
2. WHEN the claimClassifierAgent classifies a Claim whose Watched_Source has no prior Snapshot available for comparison, THE claimClassifierAgent SHALL assign that Claim the Claim_Status new.
3. IF the claimClassifierAgent cannot determine a valid Claim_Status for a Claim, THEN THE claimClassifierAgent SHALL assign that Claim the Claim_Status needs_review.
4. THE System SHALL display classified Claims in a ClaimLedger table on the Scan detail page, showing for each Claim its statement text, its type, its Claim_Status, its risk level, its confidence value, its source, and its supporting evidence.
5. THE System SHALL render a ClaimStatusBadge for each Claim using the colors: new=blue, removed=gray, weakened=orange, contradicted=red, strengthened=green, needs_review=yellow.
6. WHEN the claimClassifierAgent assigns a Claim_Status, THE System SHALL persist that Claim_Status with its associated Claim record.

### Requirement 15: Courtroom-Style Strategy Analysis

**User Story:** As a User, I want a courtroom-style debate over the evidence, so that the strategy verdict is reasoned and balanced.

#### Acceptance Criteria

1. WHEN the Mastra_Workflow reaches the debate step, THE defenseAgent SHALL produce, as structured output validated against its Zod schema, an argument that the observed changes support a meaningful company strategy shift, reasoning only over the collected Claims, Claim_Statuses, and Diffs.
2. WHEN the Mastra_Workflow reaches the debate step, THE prosecutorAgent SHALL produce, as structured output validated against its Zod schema, an argument that the observed changes may not prove a strategy shift, calling out ambiguity, weak signals, missing evidence, and copy-refresh risk, reasoning only over the collected Claims, Claim_Statuses, and Diffs.
3. WHEN both the defenseAgent and the prosecutorAgent have produced arguments, THE judgeAgent SHALL produce a Verdict, as structured output validated against its Zod schema, that includes a strategy prediction restricted to exactly one of moving_upmarket, enterprise_readiness, pricing_tightening, security_posture_change, messaging_pivot, self_serve_push, or insufficient_evidence, a confidence value that is an integer from 0 to 100 inclusive, a risk score that is an integer from 0 to 100 inclusive, and between 1 and 10 recommended actions.
4. THE System SHALL display the defense argument, the prosecution argument, and the judge conclusion on the Scan detail page using a CourtroomAnalysis component, displaying each of these elements that is available and omitting any that is unavailable without blocking the remaining elements.
5. THE defenseAgent, prosecutorAgent, and judgeAgent SHALL reason only over evidence collected by the deterministic workflow steps and SHALL NOT perform external side effects.
6. IF no Diffs were computed and no Claim was assigned a Claim_Status for the Scan, THEN THE judgeAgent SHALL produce the strategy prediction insufficient_evidence with a confidence value not exceeding 25.
7. IF any of the defenseAgent, prosecutorAgent, or judgeAgent produces output that fails its Zod schema validation, THEN THE System SHALL record the failure cause, substitute the deterministic fallback Verdict for the Demo_Company, and continue the Mastra_Workflow.

### Requirement 16: Strategy Verdict, Risk Score, and Recommended Actions

**User Story:** As a User, I want a synthesized verdict with a risk score and recommended actions, so that I can act on the intelligence.

#### Acceptance Criteria

1. WHEN the judgeAgent produces a Verdict, THE System SHALL persist a Verdict record associated with the Scan in the active Workspace, storing the strategy prediction, the confidence value, the risk score, the recommended actions, the key evidence, and the counter evidence.
2. WHEN a Scan reaches the Complete status, THE System SHALL display the strategy prediction and the confidence value (an integer from 0 to 100) in a StrategyVerdictCard on the Scan detail page.
3. WHEN a Scan reaches the Complete status, THE System SHALL display the risk score (an integer from 0 to 100) using a RiskBadge on the Scan detail page.
4. WHEN a Scan reaches the Complete status, THE System SHALL display the recommended actions from the Verdict on the Scan detail page.
5. THE System SHALL store a final brief Evidence_Artifact, formatted as a markdown report, for the Scan in the Box reports subfolder.
6. IF persisting the Verdict record fails, THEN THE System SHALL retry the persistence up to 3 attempts, and if all attempts fail, record the failure cause and display an error message indicating that the verdict could not be saved.

### Requirement 17: Final Scan Detail Results

**User Story:** As a User, I want a complete scan results page, so that I can review all findings in one place.

#### Acceptance Criteria

1. WHEN a Scan reaches the Complete status, THE System SHALL display on the Scan detail page the watched sources and detected changes summary in the middle region, the claim classifications, courtroom analysis, strategy prediction, risk score, and recommended actions in the bottom region, and the BoxEvidenceLink to the Box_Evidence_Folder in the top region.
2. IF any individual result element among the watched sources, detected changes, claim classifications, strategy prediction, risk score, recommended actions, BoxEvidenceLink, or EvidenceArtifactList has no available data when the Scan detail page loads, THEN THE System SHALL render the page with a placeholder indicating that element is unavailable and SHALL display every other result element that does have available data.
3. THE System SHALL complete loading and rendering of the Scan detail page within 3 seconds of the page being requested for a Scan in the Complete status.
4. WHEN a Scan reaches the Complete status, THE System SHALL display an EvidenceArtifactList on the Scan detail page containing one entry for each stored Evidence_Artifact, where each entry identifies the Evidence_Artifact type and its Box storage location.
5. IF a Scan in the Complete status has zero stored Evidence_Artifacts, THEN THE System SHALL display the EvidenceArtifactList with an empty-state message indicating that no evidence artifacts are available.

### Requirement 18: Demo Mode Operation

**User Story:** As a demo presenter, I want the app to run with seeded data when credentials are missing, so that the demo is reliable without external dependencies.

#### Acceptance Criteria

1. WHERE `DEMO_MODE` is set to true, THE System SHALL operate using deterministic seeded data and SHALL NOT issue network requests to Apify, Box, or the model provider.
2. IF any required credential among Apify, Box, InsForge, and the model provider is missing at the start of a Scan, THEN THE System SHALL activate Demo_Mode for the adapter that depends on the missing credential (Apify credential to Apify_Adapter, Box credential to Box_Adapter, InsForge credential to InsForge_Adapter, model provider credential to Model_Adapter) and SHALL display a warning on the Scan detail page identifying each adapter whose results are simulated.
3. WHERE Demo_Mode is active, THE System SHALL provide the Demo_Company "Acme AI" with exactly two seeded Snapshots, one previous-state Snapshot and one current-state Snapshot, covering the pricing, trust/security, docs, and careers Watched_Sources and populated with the seeded content defined for the Demo_Company.
4. WHERE Demo_Mode is inactive, THE System SHALL source all Snapshots from real scan data and SHALL place no fixed limit on the number of Snapshots (zero or more).
5. WHERE Demo_Mode is active, THE System SHALL produce the seeded Verdict with the strategy prediction exactly "Moving upmarket" and a confidence value of 82 on a 0 to 100 scale.
6. WHERE Demo_Mode is active, THE System SHALL produce seeded Claims, each assigned a Claim_Status from the defined set (new, removed, weakened, contradicted, strengthened, needs_review), reflecting: pricing moved from self-serve to contact sales; trust/security added SAML SSO, SCIM, audit logs, and data residency; careers added enterprise sales and solutions engineering roles; and docs added admin controls.
7. WHERE Demo_Mode is active, THE System SHALL produce identical seeded Snapshots, Claims, Claim_Statuses, and Verdict for the Demo_Company across repeated Scans.

### Requirement 19: External Failure Resilience

**User Story:** As a User, I want the app to keep working when external services fail, so that a scan never crashes the application.

#### Acceptance Criteria

1. IF the Apify_Adapter returns an error, throws an exception, or does not return a result within 60 seconds during a Scan, THEN THE System SHALL substitute demo snapshot data, display a warning on the Scan detail page indicating that scraped results are simulated, and continue the Mastra_Workflow to the next step.
2. IF the Box_Adapter returns an error, throws an exception, or does not return a result within 60 seconds during a Scan, THEN THE System SHALL substitute mock storage identifiers, display a warning on the Scan detail page indicating that storage results are simulated, and continue the Mastra_Workflow to the next step.
3. IF the Model_Adapter returns an error, throws an exception, or does not return a result within 60 seconds during a Scan, THEN THE System SHALL produce the deterministic fallback Verdict for the Demo_Company, display a warning on the Scan detail page indicating that analysis results are simulated, and complete the Mastra_Workflow through the Complete status.
4. WHEN a single workflow step fails recoverably and a fallback is produced within at most 3 attempts, THE System SHALL record the failure cause and continue to the next step rather than terminating the application process.
5. IF a workflow step fails and no fallback can be produced within 3 attempts, THEN THE System SHALL set the Scan to the failed state, record the failure cause, and display the failure reason on the Scan detail page.

### Requirement 20: Data Model Persistence

**User Story:** As a developer, I want a defined InsForge schema, so that all scan data is stored consistently and queried by workspace.

#### Acceptance Criteria

1. THE System SHALL persist data using the InsForge Postgres tables: workspaces, workspace_members, companies, watched_sources, scans, snapshots, diffs, claims, verdicts, and integrations.
2. THE System SHALL store, for each Workspace_Member, a reference to its Workspace, a reference to the User via auth.users(id), and a role that is exactly one of owner, admin, or member.
3. THE System SHALL store, for each Company, a reference to its owning Workspace.
4. THE System SHALL store, for each Watched_Source, a reference to its owning Company and a source-type category that is exactly one of homepage, pricing, docs, changelog, trust, careers, terms, privacy, status, or blog.
5. THE System SHALL store, for each Scan, a reference to its owning Workspace, a reference to its target Company, and a current status that is exactly one of queued, scraping, uploading, diffing, analyzing, completed, or failed.
6. THE System SHALL store, for each Snapshot, a reference to its Scan and its Watched_Source, and references to the stored raw, normalized, and screenshot Evidence_Artifacts.
7. THE System SHALL store, for each Diff, references to the prior Snapshot and the current Snapshot being compared.
8. THE System SHALL store, for each Claim, a reference to its Snapshot and, when classified, its Claim_Status.
9. THE System SHALL store, for each Verdict, a reference to its Scan, the strategy prediction, a confidence value from 0 to 100, a risk score from 0 to 100, and the recommended actions.
10. THE System SHALL store, for each Integration, a reference to its owning Workspace and a provider name that is exactly one of Apify or Box.

### Requirement 21: API Routes

**User Story:** As a frontend developer, I want defined API routes, so that the UI can manage companies, sources, scans, and integrations.

#### Acceptance Criteria

1. THE System SHALL expose `POST /api/companies` to create a Company and `GET /api/companies` to list companies in the active Workspace.
2. THE System SHALL expose `GET /api/companies/:id` to retrieve a single Company within the active Workspace, returning the Company with its Watched_Sources, its most recent Scan, its most recent Verdict, and its most recent Claims.
3. THE System SHALL expose `POST /api/companies/:id/sources` to add a Watched_Source to a Company.
4. THE System SHALL expose `POST /api/companies/:id/scans` to create and start a Scan for a Company.
5. THE System SHALL expose `GET /api/scans/:id` to retrieve a Scan within the active Workspace, returning the Scan status, its Snapshots, its Diffs, its Claims, its Verdict, and its Box Evidence_Artifacts.
6. THE System SHALL expose `POST /api/integrations/apify` and `POST /api/integrations/box` to store Integration configuration.
7. IF a request targets a resource outside the active Workspace, THEN THE System SHALL return an authorization error, including when the User is a member of the target Workspace but it is not the active Workspace.

### Requirement 22: Integration Credential Security

**User Story:** As a User, I want integration tokens kept secure, so that credentials are never exposed to the browser.

#### Acceptance Criteria

1. THE System SHALL read external provider credentials only within server-side code paths that are not delivered to the browser.
2. WHERE Demo_Mode is active, THE System SHALL transmit to the browser only credential placeholder values, each of which is not equal to any production credential value.
3. WHEN an Integration credential is stored and Demo_Mode is inactive, THE System SHALL store the credential value in encrypted form such that the persisted value is not equal to the plaintext credential value.
4. WHEN an Integration credential is stored and Demo_Mode is active, THE System SHALL store a mock placeholder value that is not equal to any production credential value.
5. IF an HTTP response is delivered to the browser, THEN THE System SHALL exclude any production credential value in unmasked form from the response body and the response headers.
6. THE System SHALL read credentials from the environment variables DEMO_MODE, APIFY_TOKEN, BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_DEVELOPER_TOKEN, INSFORGE_API_URL, INSFORGE_API_KEY, MODEL_API_KEY, and MODEL_BASE_URL.

### Requirement 23: Adapter Interfaces and Deterministic Workflow

**User Story:** As a developer, I want adapter interfaces and deterministic steps, so that the system is testable and supports demo mode cleanly.

#### Acceptance Criteria

1. THE System SHALL implement the adapter interfaces ApifyClient, BoxClient, InsForgeClient, and ModelClient as the sole access points through which System components communicate with Apify, Box, InsForge, and the model provider respectively, such that no other System component issues requests directly to those external services.
2. THE System SHALL define the Mastra_Workflow `signalVaultScanWorkflow` typed input schema containing companyId, companyName, companySlug, workspaceId, a urls collection in which each entry contains a url and a pageRole, and a mode field restricted to exactly one of the values "demo" or "live".
3. THE System SHALL define the Mastra_Workflow `signalVaultScanWorkflow` typed output schema containing scanId, a status field restricted to exactly one of the values "completed" or "failed", boxSnapshotFolderId, changedPages as an integer of 0 or greater, claimCount as an integer of 0 or greater, verdict, confidence as a number from 0 to 100 inclusive, and briefFileId.
4. THE System SHALL implement the Mastra_Workflow steps in order: createScanStep, planWatchTargetsStep, runApifyCaptureStep, normalizeArtifactsStep, uploadSnapshotToBoxStep, findPreviousSnapshotStep, computeDiffStep, extractClaimsStep, classifyClaimsStep, runDebateStep, writeBriefToBoxStep, and completeScanStep.
5. THE System SHALL validate workflow inputs, agent inputs, and agent outputs against their Zod schemas before the corresponding step or agent consumes the data.
6. IF a workflow input, an agent input, or an agent output fails its Zod schema validation, THEN THE System SHALL reject the invalid data, halt the affected step without persisting the invalid data, and surface an error indicating which field failed validation.
7. THE deterministic workflow steps SHALL collect and persist evidence, and the Analysis_Agents SHALL operate only on that persisted evidence without performing external side effects.

### Requirement 24: Model Inference Routing

**User Story:** As a developer, I want model inference routed through a configurable provider, so that the system can use the InsForge Model Gateway or an OpenAI-compatible endpoint.

#### Acceptance Criteria

1. WHEN an Analysis_Agent or workflow step requests model inference, THE Model_Adapter SHALL send the request to the OpenAI-compatible endpoint configured by MODEL_BASE_URL and authenticated by MODEL_API_KEY.
2. WHERE more than one inference provider is configured, THE Model_Adapter SHALL route each inference request to exactly one provider selected by a fixed precedence order that prefers the InsForge Model Gateway over any other configured OpenAI-compatible endpoint.
3. IF MODEL_API_KEY or MODEL_BASE_URL is missing or empty, THEN THE Model_Adapter SHALL operate in Demo_Mode, SHALL NOT send any request to an external endpoint, and SHALL return deterministic seeded analysis output for the Demo_Company.
4. IF the selected inference provider does not return a response within 60 seconds, THEN THE Model_Adapter SHALL treat the request as failed, abandon the request, and signal the failure to the calling workflow step.
