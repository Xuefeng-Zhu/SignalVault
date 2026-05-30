// Feature: signalvault, Property 7: SSRF guard blocks internal address ranges and admits public hosts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { guardUrl } from './ssrf';
import { PBT_MIN_RUNS, pbtParams } from '@/tests/fast-check.config';
import {
  loopbackIPv4Arb,
  loopbackIPv6Arb,
  private10Arb,
  private172Arb,
  private192Arb,
  privateIPv4Arb,
  linkLocalIPv4Arb,
  linkLocalIPv6Arb,
  uniqueLocalIPv6Arb,
  publicIPv4Arb,
  publicHostnameArb,
  nonHttpSchemeArb,
} from '@/tests/arbitraries/ip';

/**
 * Property 7 (Validates: Requirements 8.2):
 * For any URL whose host is a loopback (127.0.0.0/8 or ::1), private IPv4
 * (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16 or
 * fe80::/10), or unique-local IPv6 (fc00::/7) address, `guardUrl` rejects the
 * URL (ok === false); for any URL whose host is a public address or an
 * ordinary public hostname, `guardUrl` admits it (ok === true). Non-http(s)
 * schemes are rejected with reason 'non-http(s) scheme'.
 *
 * The guard is pure/synchronous and performs no DNS resolution, so these
 * properties are deterministic over generated inputs. Each property runs a
 * minimum of PBT_MIN_RUNS (100) iterations.
 */

/** Build an http URL for a bare IPv4 host or hostname. */
function httpUrl(host: string): string {
  return `http://${host}/`;
}

/** Build an http URL for a bare IPv6 address, wrapping it in brackets. */
function httpUrlV6(addr: string): string {
  return `http://[${addr}]/`;
}

describe('Property 7: SSRF guard blocks internal ranges and admits public hosts (Requirement 8.2)', () => {
  describe('blocks loopback addresses', () => {
    it('rejects IPv4 loopback 127.0.0.0/8', () => {
      fc.assert(
        fc.property(loopbackIPv4Arb, (ip) => {
          const result = guardUrl(httpUrl(ip));
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('loopback address');
        }),
        pbtParams(),
      );
    });

    it('rejects IPv6 loopback ::1', () => {
      fc.assert(
        fc.property(loopbackIPv6Arb, (addr) => {
          const result = guardUrl(httpUrlV6(addr));
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('loopback address');
        }),
        pbtParams(),
      );
    });
  });

  describe('blocks private IPv4 ranges', () => {
    it('rejects any private IPv4 (10/8, 172.16/12, 192.168/16)', () => {
      fc.assert(
        fc.property(privateIPv4Arb, (ip) => {
          const result = guardUrl(httpUrl(ip));
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('private IPv4 range');
        }),
        pbtParams(),
      );
    });

    it('rejects 10.0.0.0/8', () => {
      fc.assert(
        fc.property(private10Arb, (ip) => {
          expect(guardUrl(httpUrl(ip)).ok).toBe(false);
        }),
        pbtParams(),
      );
    });

    it('rejects 172.16.0.0/12 (second octet 16..31)', () => {
      fc.assert(
        fc.property(private172Arb, (ip) => {
          expect(guardUrl(httpUrl(ip)).ok).toBe(false);
        }),
        pbtParams(),
      );
    });

    it('rejects 192.168.0.0/16', () => {
      fc.assert(
        fc.property(private192Arb, (ip) => {
          expect(guardUrl(httpUrl(ip)).ok).toBe(false);
        }),
        pbtParams(),
      );
    });
  });

  describe('blocks link-local ranges', () => {
    it('rejects IPv4 link-local 169.254.0.0/16', () => {
      fc.assert(
        fc.property(linkLocalIPv4Arb, (ip) => {
          const result = guardUrl(httpUrl(ip));
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('link-local');
        }),
        pbtParams(),
      );
    });

    it('rejects IPv6 link-local fe80::/10', () => {
      fc.assert(
        fc.property(linkLocalIPv6Arb, (addr) => {
          const result = guardUrl(httpUrlV6(addr));
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('link-local');
        }),
        pbtParams(),
      );
    });
  });

  describe('blocks unique-local IPv6', () => {
    it('rejects fc00::/7 (fc.. and fd..)', () => {
      fc.assert(
        fc.property(uniqueLocalIPv6Arb, (addr) => {
          const result = guardUrl(httpUrlV6(addr));
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('unique-local IPv6');
        }),
        pbtParams(),
      );
    });
  });

  describe('admits public hosts', () => {
    it('admits public IPv4 addresses outside every blocked range', () => {
      fc.assert(
        fc.property(publicIPv4Arb, (ip) => {
          const result = guardUrl(httpUrl(ip));
          expect(result.ok).toBe(true);
          expect(result.reason).toBeUndefined();
        }),
        pbtParams(),
      );
    });

    it('admits ordinary public hostnames (example.com style)', () => {
      fc.assert(
        fc.property(publicHostnameArb, (host) => {
          const result = guardUrl(httpUrl(host));
          expect(result.ok).toBe(true);
          expect(result.reason).toBeUndefined();
        }),
        pbtParams(),
      );
    });

    it('admits https public hostnames too', () => {
      fc.assert(
        fc.property(publicHostnameArb, (host) => {
          expect(guardUrl(`https://${host}/`).ok).toBe(true);
        }),
        pbtParams(),
      );
    });
  });

  describe('rejects non-http(s) schemes', () => {
    it('rejects ftp/file/gopher/ws/... even with a public-looking host', () => {
      fc.assert(
        fc.property(nonHttpSchemeArb, publicHostnameArb, (scheme, host) => {
          const result = guardUrl(`${scheme}://${host}/`);
          expect(result.ok).toBe(false);
          expect(result.reason).toBe('non-http(s) scheme');
        }),
        pbtParams(),
      );
    });
  });

  it('runs each property at least 100 times', () => {
    expect(fc.readConfigureGlobal().numRuns).toBeGreaterThanOrEqual(PBT_MIN_RUNS);
  });
});
