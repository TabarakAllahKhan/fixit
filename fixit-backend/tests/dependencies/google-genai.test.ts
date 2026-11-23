import { describe, expect, it } from 'vitest';
import { GoogleGenAI } from '@google/genai';

// Verifies only that the ESM build imports and the client constructs under the
// project's module settings. No request is made and no live key is used.
describe('@google/genai dependency', () => {
  it('imports and constructs a client with a dummy key', () => {
    const client = new GoogleGenAI({ apiKey: 'test-dummy-google-key' });

    expect(client).toBeInstanceOf(GoogleGenAI);
    expect(typeof client.interactions.create).toBe('function');
  });
});
