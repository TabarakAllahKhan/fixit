// Fixture and assertion helpers for database integration tests (Phase 4A only).
// Users are created through auth.service.register so password hashing and the
// initial refresh token stay consistent with production behaviour.
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { ApplianceCategory } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/config/prisma.js';
import { register } from '../../src/services/auth.service.js';

export type TestUser = {
  id: string;
  email: string;
  username: string;
};

export async function createTestUser(): Promise<{ user: TestUser; accessToken: string }> {
  const suffix = randomBytes(8).toString('hex');
  const result = await register({
    email: `dbtest.${suffix}@example.invalid`,
    username: `dbtest_${suffix}`,
    password: 'DbTest-only-password-1',
  });

  return { user: result.user, accessToken: result.tokens.accessToken };
}

export async function createTestAppliance(
  userId: string,
  options: { modelNumber?: string | null; category?: ApplianceCategory | null } = {},
) {
  return prisma.appliance.create({
    data: {
      userId,
      // Legacy fixture category so knowledge-backed tests can still exercise
      // category-specific lookups. Pass null to model a new category-less row.
      category: options.category === undefined ? ApplianceCategory.WASHING_MACHINE : options.category,
      brand: 'TestBrand',
      // Explicit null is a valid "unknown model" fixture; undefined leaves the
      // column at its schema default (also null).
      modelNumber: options.modelNumber ?? null,
    },
  });
}

// Cascades remove appliances, sessions, messages, and refresh tokens.
export async function deleteTestUsers(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
}

export async function disconnectTestPrisma(client: PrismaClient = prisma): Promise<void> {
  await client.$disconnect();
}

export function successData(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw new Error('Expected a success envelope object');
  }
  const envelope = body as { success?: unknown; data?: unknown };
  if (envelope.success !== true || !envelope.data || typeof envelope.data !== 'object') {
    throw new Error('Expected a success envelope with a data object');
  }
  return envelope.data as Record<string, unknown>;
}

// Future DTO tests use this to prove server-managed fields never reach clients.
export function expectNoFields(data: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    if (field in data) {
      throw new Error(`Unexpected server-managed field in response: ${field}`);
    }
  }
}
