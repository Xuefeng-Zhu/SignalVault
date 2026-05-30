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
 * Deterministic seed for the Demo_Company "Dropbox".
 *
 * Dropbox demonstrates a deliberate **AI-platform pivot** between two seeded
 * Snapshots: a `previous` state (file-sync, consumer-focused, simple storage
 * plans) and a `current` state (Dropbox Dash AI assistant, enterprise admin
 * controls, AI-powered search, and aggressive AI/ML hiring). The shift maps to
 * the deterministic Verdict "AI platform pivot" (confidence 85) defined in
 * `./fallback-verdict`.
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
  name: 'Dropbox',
  domain: 'dropbox.com',
  slug: 'dropbox',
  isDemo: true,
};

/**
 * The four Watched_Sources the Demo_Company seeds content for: pricing,
 * trust/security, docs, and careers (Requirement 18.3).
 */
const ACME_WATCHED_SOURCES_DATA: DemoWatchedSource[] = [
  { pageRole: 'pricing', url: 'https://www.dropbox.com/plans' },
  { pageRole: 'trust', url: 'https://www.dropbox.com/security' },
  { pageRole: 'docs', url: 'https://www.dropbox.com/developers/documentation' },
  { pageRole: 'careers', url: 'https://www.dropbox.com/jobs' },
];

// --- Normalized content: PREVIOUS snapshot (consumer file-sync era) -----------

const PRICING_PREVIOUS = `# Plans & Pricing

Dropbox keeps your files safe, synced, and easy to share. Get started with 2 GB of free storage.

## Plans

- Basic: Free. 2 GB of storage for personal use.
- Plus: $11.99/month. 2 TB of storage, billed annually.
- Family: $19.99/month. 2 TB shared across up to 6 users.
- Professional: $24.99/month. 3 TB for freelancers and solo professionals.

All plans include file sync, file recovery, and sharing. Start free and upgrade as you grow.`;

const TRUST_PREVIOUS = `# Security

Dropbox is designed with multiple layers of protection to keep your files safe.

All files are encrypted in transit using 256-bit AES and TLS. Your data is stored on secure servers in data centers across the globe.

We offer two-step verification so you can add an extra layer of security to your account.`;

const DOCS_PREVIOUS = `# Developer Documentation

Welcome to the Dropbox Platform developer documentation.

## Getting started

Register your app, obtain an access token, and make your first API call.

## API reference

Browse endpoints for files, folders, sharing, and user account management.

## SDKs

Official SDKs for Python, JavaScript, Java, Swift, and .NET.`;

const CAREERS_PREVIOUS = `# Careers at Dropbox

We're building a more enlightened way of working. Join us.

## Open roles

- Software Engineer, Sync Engine
- Software Engineer, Mobile (iOS)
- Software Engineer, Mobile (Android)
- Product Designer, Core Experience
- Data Analyst, Growth

We are a Virtual First company. Work from anywhere that works for you.`;

// --- Normalized content: CURRENT snapshot (AI-platform pivot) -----------------

const PRICING_CURRENT = `# Plans & Pricing

Dropbox helps teams work smarter with AI-powered tools, secure collaboration, and enterprise-grade admin controls.

## Plans

- Plus: $11.99/month. 2 TB for individuals who need more storage.
- Essentials: $24.99/month. 3 TB with professional features and full-text search.
- Business: $20/user/month. Starting at 9 TB for teams, with admin controls and audit logs.
- Business Plus: $26/user/month. Advanced security, compliance, and unlimited storage for enterprises.
- Enterprise: Contact sales for custom pricing. Includes Dropbox Dash AI, advanced DLP, and dedicated support.

Enterprise plans include SSO, advanced admin controls, and a dedicated customer success manager.`;

const TRUST_CURRENT = `# Security

Dropbox protects your data with enterprise-grade security infrastructure and compliance certifications.

## Compliance

Dropbox is SOC 2 Type II, SOC 3, ISO 27001, ISO 27017, and ISO 27018 certified. HIPAA compliance is available for Business and Enterprise customers.

## Enterprise controls

- SAML 2.0 SSO and domain verification for centralized identity management.
- Advanced audit logging that captures file events, sharing activity, and administrative actions.
- Data loss prevention (DLP) to classify and protect sensitive content.
- Granular sharing controls and external sharing restrictions by domain.

## Data governance

Legal holds, data retention policies, and content lifecycle management for regulated industries. Request our security whitepaper from the trust center.`;

const DOCS_CURRENT = `# Developer Documentation

Welcome to the Dropbox Platform developer documentation.

## Getting started

Register your app, obtain an access token, and make your first API call.

## API reference

Browse endpoints for files, folders, sharing, and user account management.

## Dropbox Dash API

Integrate with Dropbox Dash to bring AI-powered universal search across all connected tools.

## AI content suggestions

Use the content intelligence API for automatic tagging, classification, and smart suggestions powered by machine learning.

## Admin SDK

Programmatically manage team members, groups, sharing policies, and audit logs for enterprise deployments.`;

const CAREERS_CURRENT = `# Careers at Dropbox

We're building the AI-powered workspace for modern teams. Join us.

## Open roles

- Senior Machine Learning Engineer, Dash AI
- Staff Engineer, AI/ML Platform
- Software Engineer, AI Search & Retrieval
- Product Manager, Dropbox Dash
- Enterprise Account Executive, EMEA
- Solutions Architect, Enterprise
- Head of AI Research

We are a Virtual First company. Work from anywhere that works for you.`;

// --- Snapshots ----------------------------------------------------------------

const PREVIOUS_SOURCES: DemoSourceContent[] = [
  { pageRole: 'pricing', url: 'https://www.dropbox.com/plans', normalizedContent: PRICING_PREVIOUS },
  { pageRole: 'trust', url: 'https://www.dropbox.com/security', normalizedContent: TRUST_PREVIOUS },
  { pageRole: 'docs', url: 'https://www.dropbox.com/developers/documentation', normalizedContent: DOCS_PREVIOUS },
  { pageRole: 'careers', url: 'https://www.dropbox.com/jobs', normalizedContent: CAREERS_PREVIOUS },
];

const CURRENT_SOURCES: DemoSourceContent[] = [
  { pageRole: 'pricing', url: 'https://www.dropbox.com/plans', normalizedContent: PRICING_CURRENT },
  { pageRole: 'trust', url: 'https://www.dropbox.com/security', normalizedContent: TRUST_CURRENT },
  { pageRole: 'docs', url: 'https://www.dropbox.com/developers/documentation', normalizedContent: DOCS_CURRENT },
  { pageRole: 'careers', url: 'https://www.dropbox.com/jobs', normalizedContent: CAREERS_CURRENT },
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
 * Seeded Claims with statuses that narrate the AI-platform pivot (Requirement
 * 18.6). Every `evidenceText` is an exact substring of the normalized content
 * for its `pageRole` at its `snapshotState`, so the seed satisfies claim
 * grounding (Requirement 13.5). The set exercises all six `Claim_Status`
 * values: new, strengthened, removed, weakened, contradicted, and needs_review.
 */
const ACME_CLAIMS_DATA: DemoClaim[] = [
  // Pricing: consumer-only → enterprise tiers with AI features.
  {
    claimType: 'pricing',
    statementText: 'Dropbox offers a free 2 GB storage tier for personal use.',
    evidenceText:
      'Basic: Free. 2 GB of storage for personal use.',
    confidence: 0.92,
    claimStatus: 'removed',
    pageRole: 'pricing',
    snapshotState: 'previous',
  },
  {
    claimType: 'pricing',
    statementText: 'Dropbox positions as simple file sync with free starter storage.',
    evidenceText: 'Get started with 2 GB of free storage.',
    confidence: 0.85,
    claimStatus: 'contradicted',
    pageRole: 'pricing',
    snapshotState: 'previous',
  },
  {
    claimType: 'pricing',
    statementText: 'Dropbox Family plan targets consumer multi-user households.',
    evidenceText: 'Family: $19.99/month. 2 TB shared across up to 6 users.',
    confidence: 0.8,
    claimStatus: 'weakened',
    pageRole: 'pricing',
    snapshotState: 'previous',
  },
  {
    claimType: 'pricing',
    statementText: 'Dropbox now offers an Enterprise tier with AI-powered Dash and custom pricing.',
    evidenceText: 'Enterprise: Contact sales for custom pricing. Includes Dropbox Dash AI, advanced DLP, and dedicated support.',
    confidence: 0.93,
    claimStatus: 'new',
    pageRole: 'pricing',
    snapshotState: 'current',
  },
  {
    claimType: 'packaging',
    statementText: 'Dropbox introduced Business Plus with unlimited storage and compliance features.',
    evidenceText: 'Business Plus: $26/user/month. Advanced security, compliance, and unlimited storage for enterprises.',
    confidence: 0.88,
    claimStatus: 'new',
    pageRole: 'pricing',
    snapshotState: 'current',
  },
  // Trust/security: added comprehensive compliance, DLP, legal holds.
  {
    claimType: 'compliance',
    statementText: 'Dropbox is SOC 2 Type II, ISO 27001, and HIPAA compliant for enterprise customers.',
    evidenceText: 'Dropbox is SOC 2 Type II, SOC 3, ISO 27001, ISO 27017, and ISO 27018 certified.',
    confidence: 0.95,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'security',
    statementText: 'Dropbox added SAML 2.0 SSO and domain verification for enterprise identity management.',
    evidenceText: 'SAML 2.0 SSO and domain verification for centralized identity management.',
    confidence: 0.93,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'security',
    statementText: 'Dropbox added data loss prevention (DLP) for sensitive content.',
    evidenceText: 'Data loss prevention (DLP) to classify and protect sensitive content.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'compliance',
    statementText: 'Dropbox offers legal holds and data retention policies for regulated industries.',
    evidenceText: 'Legal holds, data retention policies, and content lifecycle management for regulated industries.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'trust',
    snapshotState: 'current',
  },
  {
    claimType: 'security',
    statementText: 'Dropbox encrypts files in transit using 256-bit AES and TLS.',
    evidenceText: 'All files are encrypted in transit using 256-bit AES and TLS.',
    confidence: 0.85,
    claimStatus: 'strengthened',
    pageRole: 'trust',
    snapshotState: 'previous',
  },
  // Docs: added AI APIs, Admin SDK, content intelligence.
  {
    claimType: 'feature',
    statementText: 'Dropbox launched a Dash API for AI-powered universal search across connected tools.',
    evidenceText: 'Integrate with Dropbox Dash to bring AI-powered universal search across all connected tools.',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  {
    claimType: 'feature',
    statementText: 'Dropbox added a content intelligence API for automatic tagging and classification.',
    evidenceText: 'Use the content intelligence API for automatic tagging, classification, and smart suggestions powered by machine learning.',
    confidence: 0.88,
    claimStatus: 'new',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  {
    claimType: 'feature',
    statementText: 'Dropbox released an Admin SDK for enterprise programmatic management.',
    evidenceText: 'Programmatically manage team members, groups, sharing policies, and audit logs for enterprise deployments.',
    confidence: 0.82,
    claimStatus: 'new',
    pageRole: 'docs',
    snapshotState: 'current',
  },
  {
    claimType: 'feature',
    statementText: 'Dropbox provides SDKs for Python, JavaScript, Java, Swift, and .NET.',
    evidenceText: 'Official SDKs for Python, JavaScript, Java, Swift, and .NET.',
    confidence: 0.6,
    claimStatus: 'needs_review',
    pageRole: 'docs',
    snapshotState: 'previous',
  },
  // Careers: shifted from file-sync engineering to AI/ML hiring.
  {
    claimType: 'hiring',
    statementText: 'Dropbox is hiring a Senior Machine Learning Engineer for Dash AI.',
    evidenceText: 'Senior Machine Learning Engineer, Dash AI',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'careers',
    snapshotState: 'current',
  },
  {
    claimType: 'hiring',
    statementText: 'Dropbox is hiring a Staff Engineer for the AI/ML Platform.',
    evidenceText: 'Staff Engineer, AI/ML Platform',
    confidence: 0.9,
    claimStatus: 'new',
    pageRole: 'careers',
    snapshotState: 'current',
  },
  {
    claimType: 'hiring',
    statementText: 'Dropbox is hiring a Head of AI Research.',
    evidenceText: 'Head of AI Research',
    confidence: 0.78,
    claimStatus: 'new',
    pageRole: 'careers',
    snapshotState: 'current',
  },
  {
    claimType: 'hiring',
    statementText: 'Dropbox was hiring mobile engineers for the sync engine.',
    evidenceText: 'Software Engineer, Mobile (iOS)',
    confidence: 0.7,
    claimStatus: 'removed',
    pageRole: 'careers',
    snapshotState: 'previous',
  },
];

// --- Frozen canonical constants ----------------------------------------------

/** The seeded Demo_Company "Dropbox" (frozen, stable reference). */
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
