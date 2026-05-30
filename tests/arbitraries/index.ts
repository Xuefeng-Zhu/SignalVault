/**
 * Barrel for custom fast-check arbitraries (generators).
 *
 * Add SignalVault-specific generators here as the implementation grows, e.g.:
 *   - workspaces / companies / scans / snapshots
 *   - HTML documents (with script/nav/footer elements and special characters)
 *   - normalized-content pairs
 *   - IP addresses across each blocked and public CIDR range
 *   - Diff values, claim sets, and debate inputs
 *
 * Re-export each arbitrary module from this file so tests can import from
 * "@/tests/arbitraries" (or a relative path) in one place.
 */

export * from './ip';
