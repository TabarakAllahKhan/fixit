import { describe, expect, it } from 'vitest';
import {
  extractExplicitUserModelNumbers,
  extractUserModelNumbers,
  extractUserModelScopes,
  hasTrustedModel,
  parsePersistedTrustedApplianceIdentity,
  resolveTrustedApplianceIdentity,
  toPersistedTrustedApplianceIdentity,
} from '../../src/services/ai/appliance-identity.js';

const appliance = {
  category: 'WASHING_MACHINE' as const,
  brand: 'TrustedBrand',
  modelNumber: null,
};

function resolve(overrides: Partial<Parameters<typeof resolveTrustedApplianceIdentity>[0]> = {}) {
  return resolveTrustedApplianceIdentity({
    appliance,
    userMessages: [],
    currentUserContent: '',
    ...overrides,
  });
}

describe('trusted appliance identity extraction', () => {
  it('extracts model-shaped USER tokens without promoting short error codes', () => {
    expect(extractUserModelNumbers('My model is WW80T3040WW and error FE shows')).toEqual([
      'WW80T3040WW',
    ]);
    expect(extractUserModelNumbers('Error E1 on my washer')).toEqual([]);
    expect(extractUserModelNumbers('top-load washer')).toEqual([]);
  });

  it('recognizes explicit model statements as user corrections', () => {
    expect(extractExplicitUserModelNumbers('Please use model WW80T3040WW')).toEqual([
      'WW80T3040WW',
    ]);
    expect(extractExplicitUserModelNumbers('The model number is TB-100')).toEqual(['TB-100']);
  });

  it('only accepts category-appropriate configuration statements as scope', () => {
    expect(extractUserModelScopes('It is a top-load washer', 'WASHING_MACHINE')).toEqual([
      'TOP_LOAD',
    ]);
    expect(extractUserModelScopes('It has a French door and bottom freezer', 'REFRIGERATOR')).toEqual([
      'FRENCH_DOOR_BOTTOM_FREEZER',
    ]);
    expect(extractUserModelScopes('It is a top-load washer', 'REFRIGERATOR')).toEqual([]);
    expect(extractUserModelScopes('WW80T3040WW', 'WASHING_MACHINE')).toEqual([]);
  });
});

describe('resolveTrustedApplianceIdentity', () => {
  it('always takes category and brand from the supplied appliance record', () => {
    const identity = resolve({
      appliance: { category: 'REFRIGERATOR', brand: 'FreshRecord', modelNumber: null },
      persisted: { category: 'WASHING_MACHINE', brand: 'OldValue' },
      currentUserContent: 'Model WW80T3040WW',
    });

    expect(identity.category).toBe('REFRIGERATOR');
    expect(identity.brand).toBe('FreshRecord');
  });

  it('gives a registered model absolute precedence over user and persisted claims', () => {
    const identity = resolve({
      appliance: { category: 'WASHING_MACHINE', brand: 'TrustedBrand', modelNumber: 'REGISTERED-1' },
      persisted: {
        version: 1,
        modelNumber: 'OLD-PERSISTED',
        modelSource: 'USER_MESSAGE',
        modelScope: null,
        scopeSource: null,
      },
      userMessages: ['Model USER-1'],
      currentUserContent: 'Actually model USER-2, and it is front-load',
    });

    expect(identity).toMatchObject({
      modelNumber: 'REGISTERED-1',
      modelSource: 'APPLIANCE',
      modelConflict: false,
      modelScope: 'FRONT_LOAD',
      scopeSource: 'USER_MESSAGE',
    });
    expect(hasTrustedModel(identity)).toBe(true);
  });

  it('uses a changed registered model on the next resolution', () => {
    const first = resolve({
      appliance: { category: 'WASHING_MACHINE', brand: 'TrustedBrand', modelNumber: 'OLD-MODEL' },
    });
    const second = resolve({
      appliance: { category: 'WASHING_MACHINE', brand: 'TrustedBrand', modelNumber: 'NEW-MODEL' },
      persisted: toPersistedTrustedApplianceIdentity(first),
    });

    expect(second.modelNumber).toBe('NEW-MODEL');
    expect(second.modelSource).toBe('APPLIANCE');
  });

  it('does not promote a stale APPLIANCE-source model after the registered model is cleared', () => {
    const identity = resolve({
      appliance: { category: 'WASHING_MACHINE', brand: 'TrustedBrand', modelNumber: null },
      persisted: {
        version: 1,
        modelNumber: 'OLD-REGISTERED',
        modelSource: 'APPLIANCE',
        modelScope: 'TOP_LOAD',
        scopeSource: 'USER_MESSAGE',
      },
      currentUserContent: 'Still not draining',
    });

    expect(identity.modelNumber).toBeNull();
    expect(identity.modelSource).toBeNull();
    expect(identity.needsModelNumber).toBe(true);
    expect(hasTrustedModel(identity)).toBe(false);
  });

  it('ignores legacy unversioned persisted identity fields', () => {
    expect(
      parsePersistedTrustedApplianceIdentity({
        confirmedModelNumber: 'LEGACY-1',
        modelNumberSource: 'USER_MESSAGE',
        modelScope: 'TOP_LOAD',
      }),
    ).toBeNull();

    const identity = resolve({
      persisted: {
        confirmedModelNumber: 'LEGACY-1',
        modelNumberSource: 'USER_MESSAGE',
        modelScope: 'TOP_LOAD',
      },
      currentUserContent: 'Not draining',
    });

    expect(identity.modelNumber).toBeNull();
    expect(identity.modelScope).toBeNull();
  });

  it('persists a user-confirmed model only with versioned USER_MESSAGE provenance', () => {
    const first = resolve({ currentUserContent: 'My washer model is USER-MODEL-1' });
    const persisted = toPersistedTrustedApplianceIdentity(first);

    expect(persisted).toEqual({
      version: 1,
      modelNumber: 'USER-MODEL-1',
      modelSource: 'USER_MESSAGE',
      modelScope: null,
      scopeSource: null,
    });

    const second = resolve({
      persisted,
      currentUserContent: 'What should I check next?',
    });
    expect(second).toMatchObject({
      modelNumber: 'USER-MODEL-1',
      modelSource: 'USER_MESSAGE',
      needsModelNumber: false,
    });
  });

  it('rejects conflicting USER model claims instead of selecting one', () => {
    const identity = resolve({
      userMessages: ['Model WW80T3040AA'],
      currentUserContent: 'No, the model is WW80T3040BB',
    });

    expect(identity.modelNumber).toBeNull();
    expect(identity.modelSource).toBeNull();
    expect(identity.modelConflict).toBe(true);
    expect(identity.needsModelNumber).toBe(true);
    expect(hasTrustedModel(identity)).toBe(false);
  });

  it('accepts an explicit USER correction after a persisted conflict', () => {
    const conflicted = resolve({
      userMessages: ['Model WW80T3040AA'],
      currentUserContent: 'No, the model is WW80T3040BB',
    });
    expect(conflicted.modelConflict).toBe(true);

    const corrected = resolve({
      persisted: toPersistedTrustedApplianceIdentity(conflicted),
      currentUserContent: 'The model is WW80T3040CC',
    });

    expect(corrected.modelNumber).toBe('WW80T3040CC');
    expect(corrected.modelSource).toBe('USER_MESSAGE');
    expect(corrected.modelConflict).toBe(false);
  });

  it('does not infer configuration scope from a model number alone', () => {
    const identity = resolve({ currentUserContent: 'WW80T3040WW shows FE' });

    expect(identity.modelNumber).toBe('WW80T3040WW');
    expect(identity.modelScope).toBeNull();
    expect(identity.scopeSource).toBeNull();
    expect(identity.needsModelScope).toBe(true);
  });

  it('persists USER-stated scope separately from the model', () => {
    const identity = resolve({
      currentUserContent: 'It is a top-load washer, model WW80T3040WW',
    });

    expect(identity.modelScope).toBe('TOP_LOAD');
    expect(identity.scopeSource).toBe('USER_MESSAGE');
    expect(toPersistedTrustedApplianceIdentity(identity)).toMatchObject({
      version: 1,
      modelSource: 'USER_MESSAGE',
      modelScope: 'TOP_LOAD',
      scopeSource: 'USER_MESSAGE',
    });
  });

  it('treats conflicting scope claims as unknown scope', () => {
    const identity = resolve({
      userMessages: ['It is a top-load washer'],
      currentUserContent: 'Actually it is front-load',
    });

    expect(identity.modelScope).toBeNull();
    expect(identity.scopeSource).toBeNull();
    expect(identity.scopeConflict).toBe(true);
    expect(identity.needsModelScope).toBe(true);
  });
});
