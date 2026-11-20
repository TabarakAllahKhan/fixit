import { HttpError } from './httpError.js';

// Internal signal for one exact provider failure: a forced function tool
// choice was rejected because the model emitted plain text instead of the
// required call. It keeps the stable client-facing AI_PROVIDER_REJECTED
// mapping if it ever escapes the orchestrator, while allowing the forced
// final round to degrade to a deterministic, backend-owned safe turn.
export class ForcedToolNotCalledError extends HttpError {
  constructor() {
    super(502, 'AI_PROVIDER_REJECTED', 'AI provider rejected the request');
  }
}
