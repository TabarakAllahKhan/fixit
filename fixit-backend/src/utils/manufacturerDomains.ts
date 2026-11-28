import { matchAllowedDomain, normalizeHostname } from './trustedSource.js';

// Reviewed brand -> official manufacturer domain mapping.
//
// A research result counts as the appliance manufacturer's own documentation
// only when its hostname belongs to a domain mapped to *that* brand here. The
// flat RESEARCH_MANUFACTURER_DOMAINS allowlist decides what may be fetched; it
// never decides whose manufacturer a site is, so a Samsung page can never
// confirm anything about an LG appliance.
//
// Entries are deliberately conservative: only well-known primary corporate or
// support domains are listed. Brands that are not mapped (or domains we are not
// certain about) simply cannot reach MANUFACTURER_CONFIRMED. Sister brands are
// never cross-mapped (Whirlpool is not Maytag, Electrolux is not Frigidaire).
// Changes to this table must be reviewed like any other trust boundary.
const OFFICIAL_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  samsung: ['samsung.com'],
  lg: ['lg.com'],
  whirlpool: ['whirlpool.com', 'whirlpool.ca'],
  bosch: ['bosch-home.com', 'bosch.com'],
  haier: ['haier.com'],
  ge: ['geappliances.com'],
  miele: ['miele.com'],
  electrolux: ['electrolux.com'],
  frigidaire: ['frigidaire.com'],
  maytag: ['maytag.com'],
  kitchenaid: ['kitchenaid.com'],
  daikin: ['daikin.com'],
  rheem: ['rheem.com'],
  aosmith: ['aosmith.com'],
  panasonic: ['panasonic.com'],
  sharp: ['global.sharp', 'sharpusa.com'],
  beko: ['beko.com'],
};

// Common spellings of the same manufacturer, after normalization.
const BRAND_ALIASES: Readonly<Record<string, string>> = {
  lgelectronics: 'lg',
  samsungelectronics: 'samsung',
  geappliances: 'ge',
  generalelectric: 'ge',
  boschhome: 'bosch',
  aosmithwaterheaters: 'aosmith',
  fisherandpaykel: 'fisherpaykel',
};

// Brand text is user-entered. Case, spacing and punctuation are ignored so
// "A. O. Smith", "AO Smith" and "aosmith" resolve to the same key.
export function normalizeBrandKey(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function officialDomainsForBrand(brand: string): readonly string[] {
  const key = normalizeBrandKey(brand);
  if (!key) return [];
  return OFFICIAL_DOMAINS[BRAND_ALIASES[key] ?? key] ?? [];
}

// True only when the hostname belongs to an official domain mapped to this
// exact brand. Unknown brands and unmapped hosts are never official.
export function isOfficialManufacturerHost(hostname: string, brand: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  return matchAllowedDomain(host, officialDomainsForBrand(brand)) !== null;
}

// Every mapped domain, for the default research allowlist.
export function allOfficialManufacturerDomains(): string[] {
  return [...new Set(Object.values(OFFICIAL_DOMAINS).flat())];
}

// Appliance brand names used to tell which manufacturer a page or a sentence
// is about. Unlike OFFICIAL_DOMAINS this list grants no trust; it only lets
// the backend notice that text names a *different* brand. Brand names that
// are also common English words (Sharp, Candy, Hoover, Carrier, Admiral,
// Viking, Insignia, ...) are deliberately omitted, because "sharp edges" must
// not be read as a Sharp appliance page.
const KNOWN_APPLIANCE_BRANDS: readonly string[] = [
  'Samsung', 'LG', 'Whirlpool', 'Bosch', 'Haier', 'GE', 'GE Appliances', 'General Electric', 'Miele',
  'Electrolux', 'Frigidaire', 'Maytag', 'KitchenAid', 'Daikin', 'Rheem', 'A. O. Smith', 'AO Smith',
  'Panasonic', 'Beko', 'Siemens', 'Hotpoint', 'Indesit', 'Kenmore', 'Amana', 'Hisense', 'Midea',
  'Fisher & Paykel', 'Fisher and Paykel', 'Smeg', 'Zanussi', 'AEG', 'Blomberg', 'Gorenje', 'Asko',
  'Thermador', 'JennAir', 'Jenn-Air', 'Toshiba', 'Neff', 'Gaggenau', 'Sub-Zero', 'Dacor', 'Trane',
  'Lennox', 'Mitsubishi', 'Fujitsu', 'Gree', 'Westinghouse', 'Kelvinator', 'Speed Queen', 'Magic Chef',
  'Crosley', 'Galanz', 'Breville', 'De\'Longhi', 'DeLonghi', 'Dyson', 'Shark', 'Kärcher', 'Sanyo',
];

// Tokens are delimiter-bounded, and inner spaces or punctuation are flexible
// so "A.O. Smith" and "AO Smith" match the same name.
function brandBody(name: string): string {
  return name
    .trim()
    .split(/[^A-Za-z0-9À-ɏ]+/)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(String.raw`[\s.&'-]*`);
}

function brandPattern(name: string): RegExp {
  const body = brandBody(name);
  // An empty body (punctuation-only input) must never match everything.
  if (!body) return /(?!)/;
  return new RegExp(String.raw`(?:^|[^A-Za-z0-9])${body}(?=$|[^A-Za-z0-9])`, 'i');
}

const KNOWN_BRAND_PATTERNS = KNOWN_APPLIANCE_BRANDS.map((name) => ({
  key: BRAND_ALIASES[normalizeBrandKey(name)] ?? normalizeBrandKey(name),
  pattern: brandPattern(name),
}));

function canonicalBrandKey(brand: string): string {
  const key = normalizeBrandKey(brand);
  return BRAND_ALIASES[key] ?? key;
}

// True when the text names this brand (user-entered spelling or a known
// alias of the same manufacturer).
export function mentionsBrand(text: string, brand: string): boolean {
  const key = canonicalBrandKey(brand);
  if (!key || !text) return false;
  if (brandPattern(brand).test(text)) return true;
  return KNOWN_BRAND_PATTERNS.some((entry) => entry.key === key && entry.pattern.test(text));
}

// True when the text names a known appliance brand other than this one.
export function mentionsOtherBrand(text: string, brand: string): boolean {
  const key = canonicalBrandKey(brand);
  if (!text) return false;
  return KNOWN_BRAND_PATTERNS.some((entry) => entry.key !== key && entry.pattern.test(text));
}

// Regex source matching any known brand other than this one, for use inside
// larger sentence patterns (the manufacturer-claim guard).
export function otherBrandSource(brand: string): string {
  const key = canonicalBrandKey(brand);
  const names = KNOWN_APPLIANCE_BRANDS.filter(
    (name) => (BRAND_ALIASES[normalizeBrandKey(name)] ?? normalizeBrandKey(name)) !== key,
  );
  return `(?:${names.map(brandBody).filter(Boolean).join('|')})`;
}

// Regex source for this brand's own name, or an empty string when unusable.
export function brandSource(brand: string): string {
  return brandBody(brand);
}

// Changes whenever the reviewed mapping changes, so cached research tiers
// computed under an older mapping are not reused.
export function manufacturerMappingFingerprint(): string {
  return JSON.stringify({ domains: OFFICIAL_DOMAINS, aliases: BRAND_ALIASES, brands: KNOWN_APPLIANCE_BRANDS });
}
