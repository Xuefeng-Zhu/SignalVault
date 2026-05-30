/**
 * fast-check arbitraries for IP addresses across each blocked and public CIDR
 * range exercised by the SSRF guard (`lib/security/ssrf.ts`).
 *
 * These generators are intentionally precise about CIDR boundaries so that:
 *   - "blocked" arbitraries only ever produce addresses the guard MUST reject;
 *   - the "public" IPv4 arbitrary only ever produces addresses the guard MUST
 *     admit (every blocked range is excluded, plus a conservative set of other
 *     special-use ranges so the generator stays stable and unambiguous).
 *
 * Used by `lib/security/ssrf.property.test.ts` (Property 7, Requirement 8.2).
 */
import fc from 'fast-check';

/** A single IPv4 octet, 0..255. */
const octet = fc.integer({ min: 0, max: 255 });

/** A single IPv6 16-bit group rendered as a 1..4 char lowercase hex string. */
const hextet = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16));

/** Join four octets into dotted-decimal form. */
function dotted(parts: number[]): string {
  return parts.join('.');
}

// ---------------------------------------------------------------------------
// Blocked IPv4 ranges
// ---------------------------------------------------------------------------

/** Loopback 127.0.0.0/8 (e.g. 127.0.0.1, 127.42.13.7). */
export const loopbackIPv4Arb: fc.Arbitrary<string> = fc
  .tuple(octet, octet, octet)
  .map(([b, c, d]) => dotted([127, b, c, d]));

/** Private 10.0.0.0/8. */
export const private10Arb: fc.Arbitrary<string> = fc
  .tuple(octet, octet, octet)
  .map(([b, c, d]) => dotted([10, b, c, d]));

/** Private 172.16.0.0/12 (second octet 16..31). */
export const private172Arb: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 16, max: 31 }), octet, octet)
  .map(([b, c, d]) => dotted([172, b, c, d]));

/** Private 192.168.0.0/16. */
export const private192Arb: fc.Arbitrary<string> = fc
  .tuple(octet, octet)
  .map(([c, d]) => dotted([192, 168, c, d]));

/** Link-local 169.254.0.0/16. */
export const linkLocalIPv4Arb: fc.Arbitrary<string> = fc
  .tuple(octet, octet)
  .map(([c, d]) => dotted([169, 254, c, d]));

/** Any private IPv4 address (10/8, 172.16/12, or 192.168/16). */
export const privateIPv4Arb: fc.Arbitrary<string> = fc.oneof(
  private10Arb,
  private172Arb,
  private192Arb,
);

// ---------------------------------------------------------------------------
// Blocked IPv6 ranges (bare form, without brackets)
// ---------------------------------------------------------------------------

/** Loopback IPv6 ::1 (single address). */
export const loopbackIPv6Arb: fc.Arbitrary<string> = fc.constant('::1');

/** Build an 8-group IPv6 string whose first group is fixed to `first`. */
function ipv6WithFirstGroup(first: number): fc.Arbitrary<string> {
  return fc
    .tuple(hextet, hextet, hextet, hextet, hextet, hextet, hextet)
    .map((rest) => [first.toString(16), ...rest].join(':'));
}

/** Link-local IPv6 fe80::/10 (first group 0xfe80..0xfebf). */
export const linkLocalIPv6Arb: fc.Arbitrary<string> = fc
  .integer({ min: 0xfe80, max: 0xfebf })
  .chain(ipv6WithFirstGroup);

/** Unique-local IPv6 fc00::/7 (first group 0xfc00..0xfdff, i.e. fc.. and fd..). */
export const uniqueLocalIPv6Arb: fc.Arbitrary<string> = fc
  .integer({ min: 0xfc00, max: 0xfdff })
  .chain(ipv6WithFirstGroup);

// ---------------------------------------------------------------------------
// Public IPv4
// ---------------------------------------------------------------------------

/**
 * True when (a,b) falls in a range the guard blocks OR in a conservatively
 * excluded special-use range. The public generator filters these out so every
 * generated address is unambiguously public and admitted by the guard.
 */
function isExcludedPublicIPv4(a: number, b: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private 10/8
  if (a === 127) return true; // loopback 127/8
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10 (conservative)
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + 255.255.255.255
  return false;
}

/**
 * Public IPv4 addresses outside every blocked range (and outside a conservative
 * set of other special-use ranges). The guard admits all of these.
 */
export const publicIPv4Arb: fc.Arbitrary<string> = fc
  .tuple(octet, octet, octet, octet)
  .filter(([a, b]) => !isExcludedPublicIPv4(a, b))
  .map(dotted);

// ---------------------------------------------------------------------------
// Public hostnames (non-IP)
// ---------------------------------------------------------------------------

const HOST_FIRST = 'abcdefghijklmnopqrstuvwxyz';
const HOST_REST = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A DNS label that starts with a letter so it can never parse as an IPv4 int. */
const dnsLabel: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...HOST_FIRST),
    fc.stringOf(fc.constantFrom(...HOST_REST), { minLength: 0, maxLength: 12 }),
  )
  .map(([head, tail]) => head + tail);

/**
 * Ordinary public hostnames such as `example.com` or `shop42.io`. They always
 * contain at least one alphabetic label and a TLD, so the WHATWG URL parser
 * never reinterprets them as numeric IPv4 literals.
 */
export const publicHostnameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(dnsLabel, { minLength: 1, maxLength: 3 }),
    fc.constantFrom('com', 'io', 'dev', 'org', 'net', 'ai', 'co'),
  )
  .map(([labels, tld]) => [...labels, tld].join('.'));

// ---------------------------------------------------------------------------
// Non-http(s) schemes
// ---------------------------------------------------------------------------

/** Schemes that are neither http: nor https: and must be rejected. */
export const nonHttpSchemeArb: fc.Arbitrary<string> = fc.constantFrom(
  'ftp',
  'file',
  'gopher',
  'ws',
  'wss',
  'telnet',
  'ldap',
);
