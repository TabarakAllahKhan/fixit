import { describe, expect, it } from 'vitest';
import Groq from 'groq-sdk';

// Verifies only that the ESM build imports and the client constructs under the
// project's module settings. No request is made, so this says nothing about
// network connectivity or API credentials.
describe('groq-sdk dependency', () => {
  it('imports and constructs a client with a dummy key', () => {
    const client = new Groq({ apiKey: 'test-dummy-groq-key' });

    expect(client).toBeInstanceOf(Groq);
    expect(typeof client.chat.completions.create).toBe('function');
  });
});
