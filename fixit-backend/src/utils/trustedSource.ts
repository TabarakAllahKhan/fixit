import { isIP } from 'node:net';

// Pure host/URL validation shared by parts discovery and research. The
// provider's domain hint is never a trust boundary: callers must validate each
// returned URL against an explicit allowlist using these helpers.

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

export function normalizeHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (!host || host.length > 253 || CONTROL_CHARACTERS.test(host)) return null;

  const labels = host.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!DOMAIN_LABEL.test(label)) return null;
  }
  if (!TLD_LABEL.test(labels[labels.length - 1]!)) return null;
  if (isIP(host)) return null;
  return host;
}

// Configuration order is preserved so parts requests keep their existing
// include_domains hint order. Overlapping domains still match by dot boundary.
export function parseAllowedDomains(value: string | undefined): string[] {
  if (typeof value !== 'string') return [];
  const domains = new Set<string>();
  for (const part of value.split(',')) {
    const domain = normalizeHostname(part);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

export function matchAllowedDomain(hostname: unknown, domains: readonly string[]): string | null {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  for (const domain of domains) {
    const allowed = normalizeHostname(domain);
    if (!allowed) continue;
    // Dot-boundary matching rejects lookalikes such as `lg.com.evil.example`
    // and `notlg.com` without relying on unsafe `includes`/regex suffixes.
    if (host === allowed || host.endsWith(`.${allowed}`)) return allowed;
  }
  return null;
}

export type ValidatedAllowedUrl = {
  url: string;
  hostname: string;
  domain: string;
};

export function parseAllowedHttpsUrl(value: unknown, domains: readonly string[]): ValidatedAllowedUrl | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 2_048 || CONTROL_CHARACTERS.test(raw) || raw.includes('\\')) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port) return null;

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return null;
  const domain = matchAllowedDomain(hostname, domains);
  if (!domain) return null;

  // Rebuild with the normalized hostname so trailing dots and uppercase input
  // cannot survive into the returned URL or the deduplication key.
  parsed.hostname = hostname;
  return { url: parsed.toString(), hostname, domain };
}

// A conservative source identity key: host is normalized, trailing slashes and
// fragments are ignored, and query strings are preserved.
export function canonicalUrlKey(value: string): string {
  const parsed = new URL(value);
  const hostname = normalizeHostname(parsed.hostname) ?? parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.protocol}//${hostname}${pathname}${parsed.search}`;
}

export function isValidAllowedHttpsUrl(value: unknown, domains: readonly string[]): boolean {
  return parseAllowedHttpsUrl(value, domains) !== null;
}
