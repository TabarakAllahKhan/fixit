import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { HttpError } from '../../src/utils/httpError.js';
import { liveGroqBrowserResponse } from '../fixtures/groqBrowserLiveResponse.js';

const { createChatCompletionMock } = vi.hoisted(() => ({
  createChatCompletionMock: vi.fn(),
}));

vi.mock('../../src/services/groq.service.js', () => ({
  createChatCompletion: createChatCompletionMock,
}));

import {
  buildPartsQuery,
  classifyCompatibility,
  isValidPartsUrl,
  searchReplacementParts,
} from '../../src/services/parts.service.js';

const originalPartsProvider = env.PARTS_PROVIDER;
const originalAllowedDomains = env.PARTS_ALLOWED_DOMAINS;
const originalMaxResults = env.PARTS_MAX_RESULTS;

const query = {
  brand: 'LG',
  modelNumber: 'WT-H7550',
  modelSource: 'APPLIANCE' as const,
  component: 'drain pump',
  partNumber: 'AP123456',
};

beforeEach(() => {
  createChatCompletionMock.mockReset();
  env.PARTS_PROVIDER = 'none';
  env.PARTS_ALLOWED_DOMAINS = 'lg.com,partselect.com';
  env.PARTS_MAX_RESULTS = 5;
});

afterEach(() => {
  env.PARTS_PROVIDER = originalPartsProvider;
  env.PARTS_ALLOWED_DOMAINS = originalAllowedDomains;
  env.PARTS_MAX_RESULTS = originalMaxResults;
});

describe('buildPartsQuery', () => {
  it('includes exact brand/model/component and optional part number only', () => {
    expect(buildPartsQuery(query)).toBe('LG WT-H7550 drain pump replacement part part AP123456');
    expect(
      buildPartsQuery({
        brand: 'LG',
        modelNumber: 'WT-H7550',
        modelSource: 'USER_MESSAGE',
        component: 'filter',
      }),
    ).toBe('LG WT-H7550 filter replacement part');
  });
});

describe('isValidPartsUrl', () => {
  it('accepts HTTPS URLs on exact or subdomain allowlisted hosts', () => {
    expect(isValidPartsUrl('https://www.lg.com/us/washers')).toBe(true);
    expect(isValidPartsUrl('https://parts.lg.com/ap123456')).toBe(true);
    expect(isValidPartsUrl('https://partselect.com/parts/ap123456')).toBe(true);
  });

  it('rejects non-HTTPS, credentialed, IP, and non-allowlisted URLs', () => {
    expect(isValidPartsUrl('http://lg.com/parts')).toBe(false);
    expect(isValidPartsUrl('https://user:pass@lg.com/parts')).toBe(false);
    expect(isValidPartsUrl('https://127.0.0.1/parts')).toBe(false);
    expect(isValidPartsUrl('https://evil.example/parts')).toBe(false);
    expect(isValidPartsUrl('not a url')).toBe(false);
  });
});

describe('classifyCompatibility', () => {
  it('requires trusted evidence of both model and part for VERIFIED', () => {
    expect(
      classifyCompatibility({
        query,
        sourceText: 'Fits WT-H7550 drain pump, part AP123456',
        trustedSource: true,
      }),
    ).toBe('VERIFIED');
  });

  it('never classifies VERIFIED without trusted model provenance', () => {
    expect(
      classifyCompatibility({
        query: { ...query, modelSource: undefined as unknown as 'APPLIANCE' },
        sourceText: 'Fits WT-H7550 drain pump, part AP123456',
        trustedSource: true,
      }),
    ).toBe('POSSIBLE_MATCH');
  });

  it('never upgrades model-only or untrusted evidence to VERIFIED', () => {
    expect(
      classifyCompatibility({
        query,
        sourceText: 'For WT-H7550 washing machines',
        trustedSource: true,
      }),
    ).toBe('POSSIBLE_MATCH');
    expect(
      classifyCompatibility({
        query,
        sourceText: 'Fits WT-H7550 drain pump AP123456',
        trustedSource: false,
      }),
    ).toBe('POSSIBLE_MATCH');
    expect(
      classifyCompatibility({
        query,
        sourceText: 'Generic drain pump',
        trustedSource: true,
      }),
    ).toBe('POSSIBLE_MATCH');
    expect(
      classifyCompatibility({
        query,
        sourceText: 'Generic appliance accessories',
        trustedSource: true,
      }),
    ).toBe('UNKNOWN');
  });

  it('does not treat a longer, similar model number as exact', () => {
    expect(
      classifyCompatibility({
        query,
        sourceText: 'Fits WT-H7550X drain pump AP123456',
        trustedSource: true,
      }),
    ).toBe('POSSIBLE_MATCH');
  });

  it('never classifies explicit non-compatibility as a match', () => {
    expect(
      classifyCompatibility({
        query,
        sourceText: 'Not compatible with WT-H7550 drain pump AP123456',
        trustedSource: true,
      }),
    ).toBe('UNKNOWN');
  });
});

describe('searchReplacementParts', () => {
  it('is disabled by default and makes no provider call', async () => {
    const result = await searchReplacementParts(query);

    expect(result).toEqual({
      note: 'Parts search is disabled by configuration.',
      candidates: [],
    });
    expect(createChatCompletionMock).not.toHaveBeenCalled();
  });

  it('uses controlled browser search and backend-derived compatibility', async () => {
    env.PARTS_PROVIDER = 'groq_browser';
    createChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            executed_tools: [
              {
                browser_results: [
                  {
                    title: 'AP123456 drain pump for WT-H7550',
                    url: 'https://www.lg.com/us/parts/ap123456',
                    content: 'Genuine drain pump part AP123456 fits model WT-H7550.',
                  },
                  {
                    title: 'Universal pump',
                    url: 'https://www.lg.com/universal-pump',
                    content: 'A generic replacement pump with no model reference.',
                  },
                  {
                    title: 'Unsafe source',
                    url: 'http://lg.com/insecure',
                    content: 'Fits WT-H7550 AP123456',
                  },
                  {
                    title: 'Duplicate',
                    url: 'https://www.lg.com/us/parts/ap123456',
                    content: 'Duplicate of the first result.',
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = await searchReplacementParts(query);

    expect(createChatCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ type: 'browser_search' }],
        tool_choice: 'required',
        search_settings: { include_domains: ['lg.com', 'partselect.com'] },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: buildPartsQuery(query) }),
        ]),
      }),
    );
    expect(result.modelNumberUsed).toBe('WT-H7550');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      compatibility: 'VERIFIED',
      partNumber: 'AP123456',
      url: 'https://www.lg.com/us/parts/ap123456',
    });
    expect(result.candidates[1]).toMatchObject({
      compatibility: 'UNKNOWN',
      url: 'https://www.lg.com/universal-pump',
    });
    expect(result.candidates[1]?.partNumber).toBeUndefined();
    expect(result.candidates.every((candidate) => isValidPartsUrl(candidate.url))).toBe(true);
  });

  it('requires exact model information before enabling search', async () => {
    env.PARTS_PROVIDER = 'groq_browser';

    const result = await searchReplacementParts({
      brand: 'LG',
      modelNumber: '',
      modelSource: 'APPLIANCE',
      component: 'pump',
    });

    expect(result.note).toMatch(/exact brand, model number and component/i);
    expect(result.candidates).toEqual([]);
    expect(createChatCompletionMock).not.toHaveBeenCalled();
  });

  it('refuses model-specific provider calls without trusted model provenance', async () => {
    env.PARTS_PROVIDER = 'groq_browser';

    const result = await searchReplacementParts({
      brand: 'LG',
      modelNumber: 'WT-H7550',
      component: 'drain pump',
    } as Parameters<typeof searchReplacementParts>[0]);

    expect(result.note).toMatch(/trusted appliance model/i);
    expect(result.candidates).toEqual([]);
    expect(createChatCompletionMock).not.toHaveBeenCalled();
  });

  it('honours the configured result cap', async () => {
    env.PARTS_PROVIDER = 'groq_browser';
    env.PARTS_MAX_RESULTS = 1;
    createChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            executed_tools: [
              {
                browser_results: [
                  {
                    title: 'First pump',
                    url: 'https://lg.com/1',
                    content: 'drain pump information',
                  },
                  {
                    title: 'Second pump',
                    url: 'https://lg.com/2',
                    content: 'drain pump information',
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = await searchReplacementParts(query);
    expect(result.candidates).toHaveLength(1);
  });

  it('rejects malformed and irrelevant browser results', async () => {
    env.PARTS_PROVIDER = 'groq_browser';
    createChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            executed_tools: [
              {
                browser_results: [
                  null,
                  { title: '', url: 'https://lg.com/bad-title' },
                  { title: 'Missing URL' },
                  { title: 'Laundry guide', url: 'https://lg.com/guide', content: 'Care instructions' },
                  {
                    title: 'Valid pump listing',
                    url: 'https://lg.com/pump',
                    content: 'Replacement drain pump for many washers.',
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = await searchReplacementParts(query);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.url).toBe('https://lg.com/pump');
    expect(result.candidates[0]?.compatibility).toBe('POSSIBLE_MATCH');
  });

  it('extracts candidates from the observed live search_results fixture', async () => {
    env.PARTS_PROVIDER = 'groq_browser';
    createChatCompletionMock.mockResolvedValue(liveGroqBrowserResponse);

    const result = await searchReplacementParts(query);

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.url).toBe('https://www.lg.com/us/support/washers/wt-h7550');
    expect(result.candidates.every((candidate) => isValidPartsUrl(candidate.url))).toBe(true);
  });

  it('uses opened-page content from the live response but never attaches tool.output to another URL', async () => {
    env.PARTS_PROVIDER = 'groq_browser';
    createChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            executed_tools: [
              {
                name: 'browser.search',
                type: 'browser_search',
                search_results: {
                  results: [
                    {
                      title: 'Generic support page',
                      url: 'https://www.lg.com/support/generic',
                      content: '',
                      score: 0.8,
                    },
                  ],
                },
                output: `Fits ${query.modelNumber} drain pump, part ${query.partNumber}`,
              },
              {
                name: 'browser.open',
                type: 'browser.open',
                search_results: {
                  results: [
                    {
                      title: 'Drain pump listing',
                      url: 'https://www.lg.com/parts/drain-pump',
                      content: `Fits ${query.modelNumber} drain pump, part ${query.partNumber}.`,
                      score: 0.99,
                    },
                  ],
                },
                output: `Fits ${query.modelNumber} drain pump, part ${query.partNumber}`,
              },
            ],
          },
        },
      ],
    });

    const result = await searchReplacementParts(query);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      url: 'https://www.lg.com/parts/drain-pump',
      compatibility: 'VERIFIED',
      partNumber: query.partNumber,
    });
  });

  it('propagates provider failures for the orchestrator to degrade safely', async () => {
    env.PARTS_PROVIDER = 'groq_browser';
    createChatCompletionMock.mockRejectedValueOnce(
      new HttpError(503, 'AI_RATE_LIMITED', 'AI provider is rate limited'),
    );

    await expect(searchReplacementParts(query)).rejects.toMatchObject({
      code: 'AI_RATE_LIMITED',
    });
  });
});
