import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/docs/openapi.js';
import { applianceDtoSelect, toApplianceDto } from '../../src/types/appliance.dto.js';
import { toPaginatedDto } from '../../src/types/diagnosis.dto.js';

// Read the spec as JSON-like data so a missing nested key fails as an
// assertion instead of a TypeScript error.
type AnyRecord = Record<string, any>;
const spec = openApiSpec as unknown as AnyRecord;

function schema(name: string): AnyRecord {
  return spec.components.schemas[name];
}

function response(name: string): AnyRecord {
  return spec.components.responses[name];
}

function operation(path: string, method: string): AnyRecord {
  return spec.paths[path]?.[method];
}

function responseText(op: AnyRecord, status: string): string {
  const entry = op.responses?.[status] ?? {};
  const ref = entry.$ref as string | undefined;
  const name = ref?.match(/^#\/components\/responses\/(.+)$/)?.[1];
  return JSON.stringify(name ? response(name) : entry);
}

const APPLIANCE_PATHS = {
  '/appliances': ['post', 'get'],
  '/appliances/{id}': ['get', 'patch', 'delete'],
} as const;

const ALL_OPERATIONS = Object.entries(APPLIANCE_PATHS).flatMap(([path, methods]) =>
  methods.map((method) => [path, method] as const),
);

describe('appliance OpenAPI operations', () => {
  it('documents exactly the five live appliance operations', () => {
    expect(Object.keys(spec.paths).filter((path) => path.startsWith('/appliances'))).toEqual(
      Object.keys(APPLIANCE_PATHS),
    );

    for (const [path, methods] of Object.entries(APPLIANCE_PATHS)) {
      expect(Object.keys(spec.paths[path]).sort()).toEqual([...methods].sort());
    }
  });

  it.each(ALL_OPERATIONS)('requires bearer authorization for %s %s', (path, method) => {
    expect(operation(path, method).security).toEqual([{ bearerAuth: [] }]);
    expect(operation(path, method).tags).toEqual(['Appliance']);
  });

  it('describes owner-scoped appliances without inventing an ownership field', () => {
    const tag = spec.tags.find((entry: AnyRecord) => entry.name === 'Appliance');
    expect(tag.description).toMatch(/access token/i);
    expect(tag.description).not.toMatch(/userId/);
    for (const [, bodySchema] of [schema('ApplianceDto'), schema('CreateApplianceRequest')].entries()) {
      expect(Object.keys(bodySchema.properties)).not.toContain('userId');
    }
  });
});

describe('appliance OpenAPI request schemas', () => {
  it('documents the create body from the approved validator', () => {
    const body = operation('/appliances', 'post').requestBody;
    expect(body.required).toBe(true);
    expect(body.content['application/json'].schema.$ref).toBe('#/components/schemas/CreateApplianceRequest');

    const create = schema('CreateApplianceRequest');
    expect(create.additionalProperties).toBe(false);
    expect(create.required).toEqual(['category', 'brand']);
    expect(Object.keys(create.properties).sort()).toEqual(['brand', 'category', 'modelNumber', 'nickname']);
    expect(create.properties.category.$ref).toBe('#/components/schemas/ApplianceCategory');
    expect(schema('ApplianceCategory').enum).toEqual(['WASHING_MACHINE', 'REFRIGERATOR']);
    expect(create.properties.brand.minLength).toBe(1);
    expect(create.properties.brand.maxLength).toBe(120);
    expect(create.properties.modelNumber).toMatchObject({ type: 'string', nullable: true, maxLength: 80 });
    expect(create.properties.nickname).toMatchObject({ type: 'string', nullable: true, maxLength: 100 });
  });

  it('documents the partial update body and rejects empty patches', () => {
    const body = operation('/appliances/{id}', 'patch').requestBody;
    expect(body.required).toBe(true);
    expect(body.content['application/json'].schema.$ref).toBe('#/components/schemas/UpdateApplianceRequest');

    const update = schema('UpdateApplianceRequest');
    expect(update.additionalProperties).toBe(false);
    expect(update.minProperties).toBe(1);
    expect(update.required).toBeUndefined();
    expect(Object.keys(update.properties).sort()).toEqual(Object.keys(schema('CreateApplianceRequest').properties).sort());
    expect(update.description).toMatch(/at least one editable field/i);
  });

  it('documents pagination defaults and the UUID path parameter', () => {
    expect(operation('/appliances', 'get').parameters.map((p: AnyRecord) => p.$ref)).toEqual([
      '#/components/parameters/PageParam',
      '#/components/parameters/LimitParam',
    ]);
    expect(spec.components.parameters.PageParam.schema.default).toBe(1);
    expect(spec.components.parameters.LimitParam.schema.default).toBe(20);
    expect(spec.components.parameters.LimitParam.schema.maximum).toBe(100);

    for (const method of ['get', 'patch', 'delete']) {
      expect(operation('/appliances/{id}', method).parameters).toEqual([
        { $ref: '#/components/parameters/ApplianceIdParam' },
      ]);
    }
    expect(spec.components.parameters.ApplianceIdParam.schema).toMatchObject({
      type: 'string',
      format: 'uuid',
    });
  });

  it('does not document a request body for reads or deletes', () => {
    for (const [path, method] of ALL_OPERATIONS) {
      if (method === 'get' || method === 'delete') {
        expect(operation(path, method).requestBody).toBeUndefined();
      }
    }
  });
});

describe('appliance OpenAPI response schemas', () => {
  const rawAppliance = {
    id: '00000000-0000-7000-8000-000000000001',
    category: 'WASHING_MACHINE' as const,
    brand: 'LG',
    modelNumber: 'WW80T3040WW',
    nickname: 'Main washer',
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    updatedAt: new Date('2026-11-20T00:00:00.000Z'),
    userId: 'secret-user-id',
  };
  const mapped = toApplianceDto(rawAppliance);

  it('documents exactly the fields the DTO mapper returns', () => {
    const dto = schema('ApplianceDto');
    expect(Object.keys(dto.properties).sort()).toEqual(Object.keys(mapped).sort());
    expect(Object.keys(applianceDtoSelect).sort()).toEqual(Object.keys(mapped).sort());
    expect(dto.required.sort()).toEqual(Object.keys(mapped).sort());
    expect(dto.additionalProperties).toBe(false);
    expect(dto.properties.category.$ref).toBe('#/components/schemas/ApplianceCategory');
    expect(schema('ApplianceCategory').enum).toEqual(['WASHING_MACHINE', 'REFRIGERATOR']);
    expect(dto.properties.modelNumber.nullable).toBe(true);
    expect(dto.properties.nickname.nullable).toBe(true);
    expect(dto.properties.createdAt.format).toBe('date-time');
    expect(dto.properties.updatedAt.format).toBe('date-time');
    expect(JSON.stringify(mapped)).not.toContain('userId');
  });

  it('documents the shared pagination envelope with appliance items', () => {
    const paginated = schema('PaginatedApplianceDto');
    expect(Object.keys(paginated.properties).sort()).toEqual(Object.keys(toPaginatedDto([], 0, 1, 20)).sort());
    expect(paginated.required.sort()).toEqual(Object.keys(paginated.properties).sort());
    expect(paginated.properties.items.items.$ref).toBe('#/components/schemas/ApplianceDto');
  });

  it('wraps every success payload in the project response envelope', () => {
    for (const [path, method] of ALL_OPERATIONS) {
      const text = responseText(operation(path, method), method === 'post' ? '201' : '200');
      expect(text).toContain('success');
      expect(text).toContain('data');
      expect(text).toContain('Appliance');
    }
    expect(responseText(operation('/appliances', 'post'), '201')).toContain('#/components/schemas/ApplianceDto');
    expect(responseText(operation('/appliances', 'get'), '200')).toContain(
      '#/components/schemas/PaginatedApplianceDto',
    );
    expect(responseText(operation('/appliances/{id}', 'delete'), '200')).toContain(
      '#/components/schemas/MessageData',
    );
    expect(response('ApplianceDeleted')).toBeDefined();
    expect(JSON.stringify(response('ApplianceDeleted'))).toContain('Appliance deleted');
  });
});

describe('appliance OpenAPI errors and status codes', () => {
  it('documents the exact success and error statuses for each operation', () => {
    const expected: Record<string, Record<string, string[]>> = {
      '/appliances': {
        post: ['201', '400', '401', '429', '500'],
        get: ['200', '400', '401', '500'],
      },
      '/appliances/{id}': {
        get: ['200', '400', '401', '404', '500'],
        patch: ['200', '400', '401', '404', '429', '500'],
        delete: ['200', '400', '401', '404', '429', '500'],
      },
    };

    for (const [path, methods] of Object.entries(expected)) {
      for (const [method, statuses] of Object.entries(methods)) {
        expect(Object.keys(operation(path, method).responses).sort()).toEqual([...statuses].sort());
      }
    }
  });

  it('documents the shared not-found response for missing and foreign-owned appliances', () => {
    for (const method of ['get', 'patch', 'delete']) {
      const text = responseText(operation('/appliances/{id}', method), '404');
      expect(text).toContain('APPLIANCE_NOT_FOUND');
      expect(text).toContain('not owned by the caller');
    }
  });

  it('rate limits only the write operations in the documentation', () => {
    for (const [path, method, status] of [
      ['/appliances', 'post', '201'],
      ['/appliances/{id}', 'patch', '200'],
      ['/appliances/{id}', 'delete', '200'],
    ] as const) {
      expect(operation(path, method).responses['429']).toBeDefined();
      expect(responseText(operation(path, method), '429')).toContain('RATE_LIMITED');
      expect(operation(path, method).responses[status]).toBeDefined();
    }
    for (const [path, method] of [
      ['/appliances', 'get'],
      ['/appliances/{id}', 'get'],
    ] as const) {
      expect(operation(path, method).responses['429']).toBeUndefined();
    }
  });
});
