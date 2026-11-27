import { describe, expect, it } from 'vitest';
import { extractBrowserResults } from '../../src/utils/groqBrowserResponse.js';
import { liveGroqBrowserResponse } from '../fixtures/groqBrowserLiveResponse.js';

describe('extractBrowserResults', () => {
  it('reads the verified live search_results path without using narrative or tool output', () => {
    const results = extractBrowserResults(liveGroqBrowserResponse);

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({
      title: 'LG WT-H7550 support | Troubleshooting',
      url: 'https://www.lg.com/us/support/washers/wt-h7550',
      kind: 'SEARCH_RESULT',
      score: 0.94,
    });
    // Search-result content was empty in the observed response. It stays empty
    // instead of being filled from `tool.output` or `message.content`.
    expect(results[0]?.content).toBeUndefined();
    expect(results[1]?.content).toBeUndefined();

    expect(results[3]).toMatchObject({
      kind: 'OPENED_PAGE',
      title: 'LG WT-H7550 support | Troubleshooting',
      url: 'https://www.lg.com/us/support/washers/wt-h7550',
    });
    expect(results[3]?.content).toContain('WT-H7550');
    expect(results.some((result) => result.content?.includes('final narrative'))).toBe(false);
    expect(results.some((result) => result.content?.includes('[browser search results'))).toBe(false);
  });

  it('retains the legacy browser_results format as a fallback', () => {
    const results = extractBrowserResults({
      choices: [
        {
          message: {
            executed_tools: [
              {
                browser_results: [
                  { title: 'Legacy result', url: 'https://lg.com/legacy', content: 'drain pump' },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(results).toEqual([
      {
        title: 'Legacy result',
        url: 'https://lg.com/legacy',
        kind: 'SEARCH_RESULT',
        content: 'drain pump',
      },
    ]);
  });

  it('does not throw on missing, null or malformed fields', () => {
    const completion = {
      choices: [
        null,
        { message: null },
        { message: { executed_tools: null } },
        {
          message: {
            executed_tools: [
              null,
              'not-a-tool',
              { name: 'browser.search', type: 'browser_search', search_results: { results: null } },
              {
                name: 'browser.search',
                type: 'browser_search',
                search_results: {
                  results: [
                    null,
                    { title: 42, url: 'https://lg.com/bad-title' },
                    { title: 'No URL' },
                    {
                      title: 'Valid result',
                      url: 123,
                    },
                    {
                      title: 'Good result',
                      url: 'https://lg.com/good',
                      content: null,
                      score: 'not-a-number',
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    expect(() => extractBrowserResults(completion)).not.toThrow();
    expect(extractBrowserResults(completion)).toEqual([
      {
        title: 'Good result',
        url: 'https://lg.com/good',
        kind: 'SEARCH_RESULT',
      },
    ]);
  });

  it('clamps scores and bounds title and content text', () => {
    const results = extractBrowserResults({
      choices: [
        {
          message: {
            executed_tools: [
              {
                name: 'browser.open',
                type: 'browser.open',
                search_results: {
                  results: [
                    {
                      title: 'T'.repeat(700),
                      url: 'https://lg.com/long',
                      content: 'C'.repeat(25_000),
                      score: 12,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });

    expect(results[0]?.title).toHaveLength(500);
    expect(results[0]?.content).toHaveLength(20_000);
    expect(results[0]?.score).toBe(1);
  });

  it('honours the result cap across choices', () => {
    const tool = {
      name: 'browser.search',
      type: 'browser_search',
      search_results: {
        results: [
          { title: 'One', url: 'https://lg.com/1' },
          { title: 'Two', url: 'https://lg.com/2' },
          { title: 'Three', url: 'https://lg.com/3' },
        ],
      },
    };

    expect(extractBrowserResults({ choices: [{ message: { executed_tools: [tool] } }] }, 2)).toHaveLength(2);
    expect(extractBrowserResults({ choices: [] }, 2)).toEqual([]);
  });
});
