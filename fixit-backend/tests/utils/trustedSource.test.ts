import { describe, expect, it } from 'vitest';
import {
  isValidAllowedHttpsUrl,
  matchAllowedDomain,
  normalizeHostname,
  parseAllowedDomains,
  parseAllowedHttpsUrl,
} from '../../src/utils/trustedSource.js';

const domains = ['lg.com', 'partselect.com'];

describe('parseAllowedDomains', () => {
  it('normalizes, deduplicates and validates configured domains', () => {
    expect(parseAllowedDomains(' LG.COM. , parts.lg.com ,lg.com, bad_domain, localhost')).toEqual([
      'lg.com',
      'parts.lg.com',
    ]);
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });
});

describe('normalizeHostname', () => {
  it('rejects IP literals, single-label hosts and malformed labels', () => {
    expect(normalizeHostname('WWW.LG.COM.')).toBe('www.lg.com');
    expect(normalizeHostname('127.0.0.1')).toBeNull();
    expect(normalizeHostname('[::1]')).toBeNull();
    expect(normalizeHostname('localhost')).toBeNull();
    expect(normalizeHostname('-lg.com')).toBeNull();
    expect(normalizeHostname('lg..com')).toBeNull();
  });
});

describe('matchAllowedDomain', () => {
  it('accepts exact and subdomain matches with dot boundaries', () => {
    expect(matchAllowedDomain('www.lg.com', domains)).toBe('lg.com');
    expect(matchAllowedDomain('parts.lg.com', domains)).toBe('lg.com');
  });

  it('rejects lookalike and suffix-confusion hosts', () => {
    expect(matchAllowedDomain('lg.com.evil.example', domains)).toBeNull();
    expect(matchAllowedDomain('notlg.com', domains)).toBeNull();
    expect(matchAllowedDomain('evil-lg.com', domains)).toBeNull();
    expect(matchAllowedDomain('lg.com.', domains)).toBe('lg.com');
  });
});

describe('parseAllowedHttpsUrl', () => {
  it('accepts HTTPS URLs on allowlisted hosts and normalizes them', () => {
    expect(parseAllowedHttpsUrl('https://WWW.LG.COM/support', domains)).toEqual({
      url: 'https://www.lg.com/support',
      hostname: 'www.lg.com',
      domain: 'lg.com',
    });
  });

  it('rejects non-HTTPS, credentials, ports, IP literals and malformed URLs', () => {
    const rejected = [
      'http://lg.com/support',
      'https://user:pass@lg.com/support',
      'https://lg.com:8443/support',
      'https://127.0.0.1/support',
      'https://[::1]/support',
      'https://lg.com\\@evil.example/support',
      'not a url',
      'https://lg.com/\u0000hidden',
    ];
    for (const value of rejected) {
      expect(isValidAllowedHttpsUrl(value, domains)).toBe(false);
    }
  });

  it('rejects hosts outside the allowlist even when they resemble a manufacturer', () => {
    expect(isValidAllowedHttpsUrl('https://lg.com.evil.example/manual', domains)).toBe(false);
    expect(isValidAllowedHttpsUrl('https://evil-lg.com/manual', domains)).toBe(false);
    expect(isValidAllowedHttpsUrl('https://partselect.com/part', domains)).toBe(true);
  });
});
