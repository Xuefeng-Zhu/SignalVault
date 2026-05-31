/**
 * SSRF (Server-Side Request Forgery) URL guard.
 *
 * `guardUrl` is a PURE, synchronous classifier used before any Watched_Source
 * is scraped (design: `planWatchTargetsStep`, defensively re-run inside the
 * Apify adapter). It performs NO network or DNS activity so the property test
 * (task 3.2) can run it deterministically over many generated inputs.
 *
 * Scope (Requirement 8.2):
 *   - Only `http:` and `https:` schemes are admitted.
 *   - URLs whose host is a literal IP address are classified synchronously and
 *     rejected when the IP falls in a blocked range:
 *       * loopback        127.0.0.0/8, ::1
 *       * private IPv4     10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *       * link-local       169.254.0.0/16, fe80::/10
 *       * unique-local     fc00::/7 (IPv6)
 *   - IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1) are classified by the
 *     embedded IPv4 address.
 *   - Hostnames that are NOT literal IPs are admitted as public. Resolving a
 *     hostname to its addresses requires DNS and is intentionally OUT OF SCOPE
 *     for this pure guard; callers that need resolution-time protection must
 *     re-validate resolved addresses at request time.
 *   - Malformed URLs are rejected.
 */

/** Reasons a URL can be rejected by the guard. */
export type GuardRejectionReason =
  | 'malformed URL'
  | 'non-http(s) scheme'
  | 'loopback address'
  | 'private IPv4 range'
  | 'link-local'
  | 'unique-local IPv6';

/** Structured result returned for every classified URL. */
export interface GuardResult {
  /** True when the URL is admitted (public), false when it is rejected. */
  ok: boolean;
  /** Present only when `ok` is false; explains why the URL was rejected. */
  reason?: GuardRejectionReason;
}

/** A parsed IPv4 address as four octets. */
type IPv4 = [number, number, number, number];

const ADMIT: GuardResult = { ok: true };

function reject(reason: GuardRejectionReason): GuardResult {
  return { ok: false, reason };
}

/**
 * Parse a dotted-decimal IPv4 string into four octets, or return null if the
 * string is not a canonical dotted-quad with each octet in 0..255.
 */
function parseIPv4(host: string): IPv4 | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/**
 * Parse an IPv6 address (without brackets) into exactly eight 16-bit groups.
 * Supports `::` zero-run compression and a trailing embedded IPv4 dotted-quad
 * (e.g. `::ffff:127.0.0.1`). Returns null for malformed input.
 */
function parseIPv6(input: string): number[] | null {
  if (input.length === 0) return null;

  let text = input;
  const embeddedTail: number[] = [];

  // Trailing embedded IPv4 (e.g. "::ffff:127.0.0.1").
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null; // dotted but no colon => not IPv6
    const octets = parseIPv4(text.slice(lastColon + 1));
    if (!octets) return null;
    embeddedTail.push((octets[0] << 8) | octets[1]);
    embeddedTail.push((octets[2] << 8) | octets[3]);
    text = text.slice(0, lastColon);
  }

  const parseHextets = (segment: string): number[] | null => {
    if (segment === '') return [];
    const out: number[] = [];
    for (const part of segment.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  const halves = text.split('::');
  if (halves.length > 2) return null; // at most one "::"

  let groups: number[];
  if (halves.length === 2) {
    const head = parseHextets(halves[0]!);
    const tail = parseHextets(halves[1]!);
    if (head === null || tail === null) return null;
    const tailFull = [...tail, ...embeddedTail];
    const fill = 8 - head.length - tailFull.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...tailFull];
  } else {
    const head = parseHextets(halves[0]!);
    if (head === null) return null;
    groups = [...head, ...embeddedTail];
  }

  if (groups.length !== 8) return null;
  return groups;
}

/** Classify a literal IPv4 address against the blocked ranges. */
function classifyIPv4(octets: IPv4): GuardResult {
  const [a, b] = octets;
  if (a === 127) return reject('loopback address'); // 127.0.0.0/8
  if (a === 10) return reject('private IPv4 range'); // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return reject('private IPv4 range'); // 172.16.0.0/12
  if (a === 192 && b === 168) return reject('private IPv4 range'); // 192.168.0.0/16
  if (a === 169 && b === 254) return reject('link-local'); // 169.254.0.0/16
  return ADMIT;
}

/** Classify a parsed IPv6 address (eight 16-bit groups) against blocked ranges. */
function classifyIPv6(groups: number[]): GuardResult {
  const g = (i: number): number => groups[i] ?? 0;
  const zeroPrefix = (count: number): boolean => {
    for (let i = 0; i < count; i += 1) {
      if (g(i) !== 0) return false;
    }
    return true;
  };

  // IPv4-mapped IPv6 (::ffff:0:0/96) -> classify by the embedded IPv4.
  if (zeroPrefix(5) && g(5) === 0xffff) {
    const embedded: IPv4 = [
      (g(6) >> 8) & 0xff,
      g(6) & 0xff,
      (g(7) >> 8) & 0xff,
      g(7) & 0xff,
    ];
    return classifyIPv4(embedded);
  }

  // Loopback ::1
  if (zeroPrefix(7) && g(7) === 1) return reject('loopback address');

  const first = g(0);
  if ((first & 0xffc0) === 0xfe80) return reject('link-local'); // fe80::/10
  if ((first & 0xfe00) === 0xfc00) return reject('unique-local IPv6'); // fc00::/7

  return ADMIT;
}

/**
 * Classify a URL for SSRF safety.
 *
 * @param url A URL string. Literal IP hosts (IPv4 and IPv6, including bracketed
 *   IPv6 such as `http://[::1]/`) are classified synchronously; non-IP
 *   hostnames are admitted as public without DNS resolution.
 * @returns `{ ok: true }` when admitted, or `{ ok: false, reason }` when rejected.
 */
export function guardUrl(url: string): GuardResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return reject('malformed URL');
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    return reject('non-http(s) scheme');
  }

  const host = parsed.hostname;
  if (host.length === 0) return reject('malformed URL');

  // Bracketed IPv6 literal, e.g. http://[::1]/ (WHATWG URL keeps the brackets).
  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = parseIPv6(host.slice(1, -1));
    if (!groups) return reject('malformed URL');
    return classifyIPv6(groups);
  }

  // Literal IPv4 host.
  const v4 = parseIPv4(host);
  if (v4) return classifyIPv4(v4);

  // Defensive: an unbracketed IPv6 (a ':' is illegal in a DNS hostname).
  if (host.includes(':')) {
    const groups = parseIPv6(host);
    if (!groups) return reject('malformed URL');
    return classifyIPv6(groups);
  }

  // Non-IP hostname: DNS resolution is out of scope for this pure guard.
  return ADMIT;
}

/**
 * Async DNS-resolving SSRF guard. Resolves the hostname to IP addresses and
 * validates each resolved IP against the blocked ranges. This prevents DNS
 * rebinding attacks where a public hostname resolves to a private/loopback IP.
 *
 * Should be called AFTER the pure `guardUrl` check passes, at the point where
 * the URL will actually be fetched.
 */
export async function guardResolvedUrl(rawUrl: string): Promise<GuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return reject("malformed URL");
  }

  const host = parsed.hostname;

  // Skip resolution for literal IPs (already handled by guardUrl)
  if (parseIPv4(host) || host.includes(":")) {
    return ADMIT;
  }

  try {
    const { resolve4, resolve6 } = await import("node:dns/promises");

    // Resolve IPv4 addresses
    let v4Addrs: string[] = [];
    try {
      v4Addrs = await resolve4(host);
    } catch {
      // ENODATA / ENOTFOUND is fine — host may be IPv6 only
    }

    for (const addr of v4Addrs) {
      const octets = parseIPv4(addr);
      if (octets) {
        const result = classifyIPv4(octets);
        if (!result.ok) return result;
      }
    }

    // Resolve IPv6 addresses
    let v6Addrs: string[] = [];
    try {
      v6Addrs = await resolve6(host);
    } catch {
      // ENODATA / ENOTFOUND is fine
    }

    for (const addr of v6Addrs) {
      const groups = parseIPv6(addr);
      if (groups) {
        const result = classifyIPv6(groups);
        if (!result.ok) return result;
      }
    }

    // No addresses resolved at all — reject (host doesn't exist)
    if (v4Addrs.length === 0 && v6Addrs.length === 0) {
      return reject("malformed URL");
    }

    return ADMIT;
  } catch {
    // DNS resolution failed entirely — reject defensively
    return reject("malformed URL");
  }
}
