import type { Claim } from '@/lib/schemas';

import { cloneSeed, deepFreeze } from './freeze';
import type {
  DemoClaim,
  DemoCompany,
  DemoSnapshot,
  DemoSourceContent,
  DemoWatchedSource,
} from './types';

/**
 * Deterministic seed for the Demo_Company "Acme AI".
 *
 * Acme AI demonstrates a deliberate **upmarket strategy shift** between two
 * seeded Snapshots: a `previous` state (self-serve, free tier, light security)
 * and a `current` state (contact-sales pricing, enterprise security &
 * compliance, admin controls in the docs, and enterprise go-to-market hiring).
 * The shift maps to the deterministic Verdict "Moving upmarket" (confidence 82)
 * defined in `./fallback-verdict`.
 *
 * Everything in this module is pure and deterministic — no randomness, no
 * timestamps, no ids, no network — so Demo_Mode produces identical snapshots,
 * claims, and statuses across repeated scans (Requirement 18.7). The canonical
 * data is deep-frozen and the `build*` helpers return deep clones, so callers
 * receive deeply-equal results on every invocation and cannot mutate the seed.
 *
 * Claim `evidenceText` values are exact substrings of the normalized content of
 * the corresponding source and snapshot state, so the downstream grounding rule
 * (Requirement 13.5) holds for the seed.
 *
 * Requirements: 18.3, 18.5, 18.6, 18.7
 */

/** The seeded Demo_Company identity (Requirement 18.3). */
const ACME_DEMO_COMPANY_DATA: DemoCompany = {
  name: 'Acme AI',
  domain: 'acme.ai',
  slug: 'acme-ai',
  isDemo: true,
};

/**
 * The four Watched_Sources the Demo_Company seeds content for: pricing,
 * trust/security, docs, and careers (Requirement 18.3).
 */
const ACME_WATCHED_SOURCES_DATA: DemoWatchedSource[] = [
  { pageRole: 'pricing', url: 'https://acme.ai/pricing' },
  { pageRole: 'trust', url: 'https://acme.ai/trust' },
  { pageRole: 'docs', url: 'https://docs.acme.ai' },
  { pageRole: 'careers', url: 'https://acme.ai/careers' },
];

// --- Normalized content: PREVIOUS snapshot (self-serve, pre-upmarket) --------

const PRICING_PREVIOUS = `# Pricing

Start for free, no credit card required. Acme AI offers a free self-serve tier so any developer can sign up and start building in minutes.

## Plans

- Free: $0/month. Generous limits for individuals and side projects.
- Pro: $49/month. For growing teams, billed monthly, cancel anytime.

Self-serve checkout. Upgrade or downgrade instantly from your dashboard.`;

const TRUST_PREVIOUS = `# Trust & Security

Security is important to us. All data is encrypted in transit using TLS.

We follow security best practices and review our infrastructure regularly.`;

const DOCS_PREVIOUS = `# Documentation

Welcome to the Acme AI docs.

## Getting started

Install the SDK and authenticate with your API key.

## API reference

Browse endpoints for completions, embeddings, and files.`;

const CAREERS_PREVIOUS = `# Careers

Join Acme AI. We are a small, product-focused team.

## Open roles

- Software Engineer, Backend
- Software Engineer, Frontend
- Developer Advocate

We hire remotely across North America.`;

// --- Normalized content: CURRENT snapshot (upmarket shift) -------------------

const PRICING_CURRENT = `# Pricing

Acme AI is built for teams with serious requirements. Contact our sales team to find the right plan for your organization.

## Plans

- Team: Custom pricing. For growing teams, billed annually.
- Enterprise: Contact sales for a custom quote. Includes SSO, audit logs, and a dedicated success manager.

Enterprise plans require an annual contract and an onboarding call with our team.`;

const TRUST_CURRENT = `# Trust & Security

Acme AI is SOC 2 Type II certified and HIPAA compliant. All data is encrypted in transit and at rest.

## Enterprise controls

- SAML SSO and SCIM provisioning for centralized identity management.
- Audit logs that capture every administrative action.
- Data residency options in the US and EU regions.

Request our security package and penetration test reports from the trust center.`;

const DOCS_CURRENT = `# Documentation

Welcome to the Acme AI docs.

## Getting started

Install the SDK and authenticate with your API key.

## API reference

Browse endpoints for completions, embeddings, and files.

## Administration

Admin controls let workspace owners manage members, roles, and permissions.

## Single sign-on

Configure SSO and SAML for your organization, including SCIM user provisioning.

## Role-based access control

Assign roles to enforce least-privilege access across your workspace.`;

const CAREERS_CURRENT = `# Careers

Join Acme AI as we scale to serve the world's largest organizations.

## Open roles

- Software Engineer, Backend
- Enterprise Account Executive
- Solutions Engineer
- Customer Success Manager, Enterprise
- Head of Security & Compliance

We are building out our enterprise go-to-market team.`;

// --- Snapshots ----------------------------------------------------------------

const PREVIOUS_SOURCES: DemoSourceContent[] = [
  { pageRole: 'pricing', url: 'https://acme.ai/pricing', normalizedContent: PRICING_PREVIOUS },
  { pageRole: 'trust', url: 'https://acme.ai/trust', normalizedContent: TRUST_PREVIOUS },
  { pageRole: 'docs', url: 'https://docs.acme.ai', normalizedContent: DOCS_PREVIOUS },
  { pageRole: 'careers', url: 'https://acme.ai/careers', normalizedContent: CAREERS_PREVIOUS },
];

const CURRENT_SOURCES: DemoSourceContent[] = [
  { pageRole: 'pricing', url: 'https://acme.ai/pricing', normalizedContent: PRICING_CURRENT },
  { pageRole: 'trust', url: 'https://acme.ai/trust', normalizedContent: TRUST_CURRENT },
  { pageRole: 'docs', url: 'https://docs.acme.ai', normalizedContent: DOCS_CURRENT },
  { pageRole: 'careers', url: 'https://acme.ai/careers', normalizedContent: CAREERS_CURRENT },
];

/**
 * Exactly two seeded Snapshots — a previous-state and a current-state — each
 * covering all four Watched_Sources (Requirement 18.3).
 */
const ACME_SNAPSHOTS_DATA: DemoSnapshot[] = [
  { state: 'previous', sources: PREVIOUS_SOURCES },
  { state: 'current', sources: CURRENT_SOURCES },
];

// --- Claims -------------------------------------------------------------------

/**
 * Seeded Claims with statuses that narrate the upmarket shift (Requirement
 * 18.6). Every `evidenceText` is an exact substring of the normalized content
 * for its `pageRole` at its `snapshotState`, so the seed satisfies claim
 * grounding (Requirement 13.5). The set exercises all six `Claim_Status`
 * values: new, strengthened, removed, weakened, contradicted, and needs_review.
 */
const ACME_CLAIMS_DATA: DemoClaim[] = [
  // Pricing: self-serve/free → contact-sales/enterprise.
  {
    claimType: 'pricing',
    statementText: 'Acme AI offers a free, self-serve tier.',
    evidenceText:
      'Acme AI offers a free self-serve tier so any developer can sign up and start building in minutes.',
    confidence: 0.92,
    claimStatus: 'removed',
    pageRole: 'pricing',
    snapshotState: 'previous',
  },
  {
    claimType: 'pricing',
    statementText: 'Acme AI lets users start for free with no credit card.',
    evidenceText: 'Start for free, no credit card required.',
    confidence: 0.85,
    claimStatus: 'contradicted',
    pageRole: 'pricing',
    snapshotState: 'previous',
  },
  {
    claimType: 'pricing',
    statementText: 'Pro pricing is self-serve and billed monthly with cancel-anytime terms.',
    evidenceText: 'Pro: $49/month. For growing teams, billed monthly, cancel anytime.',
    confidence: 0.8,
    claimStatus: 'weakened',
    pageRole: 'pricing',
    snapshotState: 'previous',
  },
  {
    claimType: 'pricing',
    statementText: 'Acme AI now directs prospective customers to contact sales.',
    evidenceText: 'Contact our sales team to find the right plan for your organization.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'pricing',
    snapshotState: 'current',
  },
  {
    claimType: 'packaging',
    statementText: 'Acme AI introduced an Enterprise plan with quote-based pricing.',
    evidenceText: 'Enterprise: Contact sales for a custom quote.',
    confidence: 0.88,
    claimStatus: 'new',
    pageRole: 'pricing',
    snapshotState: 'current',
  },
  // Trust/security: added SOC 2, HIPAA, SAML SSO, SCIM, audit logs, data residency.
  {
    claimType: 'compliance',
    statementText: 'Acme AI is SOC 2 Type II certified and HIPAA compliant.',
    evidenceText: 'Acme AI is SOC 2 Type II certified and HIPAA compliant.',
    confidence: 0.95,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'security',
    statementText: 'Acme AI added SAML SSO and SCIM provisioning.',
    evidenceText: 'SAML SSO and SCIM provisioning for centralized identity management.',
    confidence: 0.93,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'security',
    statementText: 'Acme AI added audit logs for administrative actions.',
    evidenceText: 'Audit logs that capture every administrative action.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'compliance',
    statementText: 'Acme AI offers US and EU data residency options.',
    evidenceText: 'Data residency options in the US and EU regions.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'security',
    statementText: 'Acme AI encrypts data in transit.',
    evidenceText: 'All data is encrypted in transit using TLS.',
    confidence: 0.85,
    claimStatus: 'strengthened',
    pageRole: 'trust',
    snapshotState: 'previous',
  },
  // Docs: added admin controls, SSO/SAML setup, role-based access control.
  {
    claimType: 'feature',
    statementText: 'Acme AI docs added admin controls for managing members and roles.',
    evidenceText: 'Admin controls let workspace owners manage members, roles, and permissions.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  {
    claimType: 'integration',
    statementText: 'Acme AI docs added an SSO/SAML configuration guide.',
    evidenceText: 'Configure SSO and SAML for your organization, including SCIM user provisioning.',
    confidence: 0.88,
    claimStatus: 'new',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  {
    claimType: 'feature',
    statementText: 'Acme AI documented role-based access control.',
    evidenceText: 'Assign roles to enforce least-privilege access across your workspace.',
    confidence: 0.82,
    claimStatus: 'new',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  {
    claimType: 'feature',
    statementText: 'Acme AI provides completions, embeddings, and files API endpoints.',
    evidenceText: 'Browse endpoints for completions, embeddings, and files.',
    confidence: 0.6,
    claimStatus: 'needs_review',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  // Careers: added enterprise sales and solutions engineering roles.
  {
    claimType: 'hiring',
    statementText: 'Acme AI is hiring an Enterprise Account Executive.',
    evidenceText: 'Enterprise Account Executive',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'careers',
    snapshotState: 'current',
  },
  {
    claimType: 'hiring',
    statementText: 'Acme AI is hiring a Solutions Engineer.',
    evidenceText: 'Solutions Engineer',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'careers',
    snapshotState: 'current',
  },
  {
    claimType: 'hiring',
    statementText: 'Acme AI is hiring a Head of Security & Compliance.',
    evidenceText: 'Head of Security & Compliance',
    confidence: 0.78,
    claimStatus: 'new',
    pageRole: 'careers',
    snapshotState: 'current',
  },
  {
    claimType: 'hiring',
    statementText: 'Acme AI was hiring a Developer Advocate for community growth.',
    evidenceText: 'Developer Advocate',
    confidence: 0.7,
    claimStatus: 'removed',
    pageRole: 'careers',
    snapshotState: 'previous',
  },
];

// --- Frozen canonical constants ----------------------------------------------

/** The seeded Demo_Company "Acme AI" (frozen, stable reference). */
export const ACME_DEMO_COMPANY: DemoCompany = deepFreeze(ACME_DEMO_COMPANY_DATA);

/** The Demo_Company's four Watched_Sources (frozen, stable reference). */
export const ACME_WATCHED_SOURCES: readonly DemoWatchedSource[] = deepFreeze(
  ACME_WATCHED_SOURCES_DATA,
);

/** The two seeded Snapshots, previous then current (frozen, stable reference). */
export const acmeSnapshots: readonly DemoSnapshot[] = deepFreeze(ACME_SNAPSHOTS_DATA);

/** The seeded, status-classified Claims (frozen, stable reference). */
export const acmeClaims: readonly DemoClaim[] = deepFreeze(ACME_CLAIMS_DATA);

// --- Deterministic builders (deep clones; deeply equal across calls) ---------

/** Build a fresh, mutable copy of the Demo_Company identity. */
export function buildAcmeCompany(): DemoCompany {
  return cloneSeed(ACME_DEMO_COMPANY_DATA);
}

/** Build a fresh, mutable copy of the Demo_Company's Watched_Sources. */
export function buildAcmeWatchedSources(): DemoWatchedSource[] {
  return cloneSeed(ACME_WATCHED_SOURCES_DATA);
}

/** Build fresh, mutable copies of the two seeded Snapshots. */
export function buildAcmeSnapshots(): DemoSnapshot[] {
  return cloneSeed(ACME_SNAPSHOTS_DATA);
}

/** Build fresh, mutable copies of the seeded Claims. */
export function buildAcmeClaims(): DemoClaim[] {
  return cloneSeed(ACME_CLAIMS_DATA);
}

/**
 * Project a {@link DemoClaim} onto the shared {@link Claim} shape (the four
 * fields validated by `ClaimSchema`), dropping the demo-only status/source
 * metadata. Useful where downstream code expects schema-conformant claims.
 */
export function toClaim(demoClaim: DemoClaim): Claim {
  return {
    claimType: demoClaim.claimType,
    statementText: demoClaim.statementText,
    evidenceText: demoClaim.evidenceText,
    confidence: demoClaim.confidence,
  };
}

/** Build the seeded Claims projected onto the shared {@link Claim} schema shape. */
export function buildAcmeClaimRecords(): Claim[] {
  return ACME_CLAIMS_DATA.map(toClaim);
}
