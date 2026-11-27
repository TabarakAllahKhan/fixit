// Synthetic fixture modeled on the verified Phase 2A Groq response shape.
// Values are invented test data; no provider response text or credentials are
// reproduced.

export const liveGroqBrowserResponse = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content:
          'Check the drain filter and confirm the model-specific guidance before continuing.',
        executed_tools: [
          {
            name: 'browser.search',
            type: 'browser_search',
            search_settings: { include_domains: ['lg.com'] },
            search_results: {
              results: [
                {
                  title: 'LG WT-H7550 support | Troubleshooting',
                  url: 'https://www.lg.com/us/support/washers/wt-h7550',
                  content: '',
                  score: 0.94,
                },
                {
                  title: 'LG washing machine owner manuals',
                  url: 'https://www.lg.com/us/support/manuals/washers',
                  content: '   ',
                  score: 0.81,
                },
                {
                  title: 'A discussion about washers',
                  url: 'https://forums.example.invalid/thread/1',
                  content: '',
                  score: 0.42,
                },
              ],
            },
            output: '[browser search results were returned]',
          },
          {
            name: 'browser.open',
            type: 'browser.open',
            search_results: {
              results: [
                {
                  title: 'LG WT-H7550 support | Troubleshooting',
                  url: 'https://www.lg.com/us/support/washers/wt-h7550',
                  content:
                    'For model WT-H7550, error E1 indicates a drain obstruction. Inspect the drain filter and pump inlet.',
                  score: 0.99,
                },
              ],
            },
            output: 'For model WT-H7550, error E1 indicates a drain obstruction.',
          },
        ],
      },
    },
  ],
};
