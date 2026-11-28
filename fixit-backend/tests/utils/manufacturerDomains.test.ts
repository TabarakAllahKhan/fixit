import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.schema.js';
import {
  allOfficialManufacturerDomains,
  isOfficialManufacturerHost,
  mentionsBrand,
  mentionsOtherBrand,
  normalizeBrandKey,
  officialDomainsForBrand,
} from '../../src/utils/manufacturerDomains.js';
import { parseAllowedDomains } from '../../src/utils/trustedSource.js';

describe('brand mentions in evidence text', () => {
  it.each([
    ['LG', 'LG dishwasher E1 error'],
    ['LG Electronics', 'On LG washers this code means...'],
    ['A. O. Smith', 'AO Smith water heater codes'],
    ['GE', 'GE Appliances error list'],
    ['Fisher & Paykel', 'Fisher and Paykel dishdrawer'],
  ])('finds brand %s in "%s"', (brand, text) => {
    expect(mentionsBrand(text, brand)).toBe(true);
  });

  it.each([
    ['LG', 'Clean the filter'],
    ['LG', 'Algorithm for the cycle'],
    ['Samsung', 'Samsungs are popular'],
    ['...', 'anything'],
  ])('does not find brand %s in "%s"', (brand, text) => {
    expect(mentionsBrand(text, brand)).toBe(false);
  });

  it('detects a different brand but not the same manufacturer under an alias', () => {
    expect(mentionsOtherBrand('Samsung dishwasher E1', 'LG')).toBe(true);
    expect(mentionsOtherBrand('GE Appliances support', 'General Electric')).toBe(false);
    expect(mentionsOtherBrand('LG dishwasher E1', 'LG')).toBe(false);
  });

  it('ignores brand names that are ordinary words', () => {
    expect(mentionsOtherBrand('Watch for sharp edges and hoover up the debris', 'LG')).toBe(false);
  });
});

describe('reviewed manufacturer domain mapping', () => {
  it.each([
    ['LG', 'www.lg.com'],
    ['Samsung', 'www.samsung.com'],
    ['Miele', 'www.miele.com'],
    ['Electrolux', 'www.electrolux.com'],
    ['Frigidaire', 'www.frigidaire.com'],
    ['Maytag', 'www.maytag.com'],
    ['KitchenAid', 'www.kitchenaid.com'],
    ['Daikin', 'www.daikin.com'],
    ['Rheem', 'www.rheem.com'],
    ['A. O. Smith', 'www.aosmith.com'],
    ['Panasonic', 'www.panasonic.com'],
    ['Sharp', 'global.sharp'],
    ['Beko', 'www.beko.com'],
    ['GE Appliances', 'www.geappliances.com'],
  ])('maps %s to its own official host %s', (brand, host) => {
    expect(isOfficialManufacturerHost(host, brand)).toBe(true);
  });

  it.each([
    ['LG', 'www.samsung.com'],
    ['Samsung', 'www.lg.com'],
    ['Maytag', 'www.whirlpool.com'],
    ['Frigidaire', 'www.electrolux.com'],
    ['LG', 'lg.com.evil.example'],
    ['LG', 'notlg.com'],
    ['Unknown Brand', 'www.lg.com'],
    ['', 'www.lg.com'],
  ])('rejects %s on %s', (brand, host) => {
    expect(isOfficialManufacturerHost(host, brand)).toBe(false);
  });

  it('normalizes brand spelling without loose prefix matching', () => {
    expect(normalizeBrandKey('A.O. Smith')).toBe('aosmith');
    expect(officialDomainsForBrand('AO Smith')).toEqual(['aosmith.com']);
    expect(officialDomainsForBrand('LG Electronics')).toEqual(['lg.com']);
    // "LGX" is a different brand, not a prefix match for LG.
    expect(officialDomainsForBrand('LGX')).toEqual([]);
    expect(officialDomainsForBrand('Samsungite')).toEqual([]);
  });

  it('keeps the default research allowlist in sync with every mapped domain', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/fixit',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const allowlist = parseAllowedDomains(parsed.data.RESEARCH_MANUFACTURER_DOMAINS);
    for (const domain of allOfficialManufacturerDomains()) {
      expect(allowlist).toContain(domain);
    }
  });
});
