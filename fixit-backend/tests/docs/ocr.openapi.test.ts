import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/docs/openapi.js';

type AnyRecord = Record<string, any>;
const spec = openApiSpec as unknown as AnyRecord;
const operation = spec.paths['/ocr/error-code'].post as AnyRecord;

describe('OCR OpenAPI contract', () => {
  it('documents one authenticated multipart operation with a binary image field', () => {
    expect(spec.tags.map((tag: AnyRecord) => tag.name)).toContain('OCR');
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.tags).toEqual(['OCR']);

    const body = operation.requestBody;
    expect(body.required).toBe(true);
    const multipart = body.content['multipart/form-data'];
    expect(multipart.schema.required).toEqual(['image']);
    expect(multipart.schema.properties.image).toMatchObject({ type: 'string', format: 'binary' });
    expect(JSON.stringify(operation.description)).toMatch(/5 MB/);
    expect(JSON.stringify(operation.description)).toMatch(/image\/png/);
  });

  it('documents detected, ambiguous and unreadable 200 examples', () => {
    const result = spec.components.responses.OcrDetectionResult as AnyRecord;
    expect(operation.responses['200']).toEqual({ $ref: '#/components/responses/OcrDetectionResult' });

    const responseContent = result.content['application/json'];
    expect(responseContent.schema.properties.data.$ref).toBe('#/components/schemas/OcrDetectionData');
    expect(Object.keys(responseContent.examples).sort()).toEqual(['ambiguous', 'detected', 'unreadable']);

    const examples = responseContent.examples;
    expect(examples.detected.value.data.status).toBe('DETECTED');
    expect(examples.detected.value.data.code).toBe('E03');
    expect(examples.ambiguous.value.data.status).toBe('AMBIGUOUS');
    expect(examples.ambiguous.value.data.code).toBeNull();
    expect(examples.unreadable.value.data.status).toBe('UNREADABLE');
    expect(examples.unreadable.value.data.message).toBe(
      "We couldn't clearly read the error code. Please upload a clearer image with the display text in focus.",
    );

    const schema = spec.components.schemas.OcrDetectionData as AnyRecord;
    expect(schema.required).toEqual(['status', 'code', 'candidates', 'message', 'ocrConfidence']);
    expect(schema.properties.status.enum).toEqual(['DETECTED', 'AMBIGUOUS', 'UNREADABLE']);
  });

  it('documents validation, authentication, rate limit and server errors', () => {
    expect(operation.responses['400']).toBeDefined();
    expect(JSON.stringify(operation.responses['400'])).toMatch(/File too large/);
    expect(operation.responses['401']).toEqual({ $ref: '#/components/responses/Unauthorized' });
    expect(operation.responses['429']).toEqual({ $ref: '#/components/responses/RateLimited' });
    expect(operation.responses['500']).toEqual({ $ref: '#/components/responses/InternalError' });
  });
});
