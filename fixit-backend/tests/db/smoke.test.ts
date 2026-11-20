import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { disconnectTestPrisma } from './helpers.js';

afterAll(async () => {
  await disconnectTestPrisma();
});

describe('fixit-test smoke checks (read-only)', () => {
  it('can execute a trivial query', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT true AS ok`;
    expect(rows[0]?.ok).toBe(true);
  });

  it('has the five finished migrations', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    expect(rows[0]?.count).toBe(5);
  });

  it('has the expected Verdict enum', async () => {
    const rows = await prisma.$queryRaw<Array<{ label: string }>>`
      SELECT e.enumlabel AS label FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'Verdict' ORDER BY e.enumsortorder
    `;
    expect(rows.map((row) => row.label)).toEqual([
      'FIXED',
      'NEEDS_PART',
      'TECHNICIAN_REQUIRED',
      'UNRESOLVED',
    ]);
  });

  it('has three nullable fixConfirmation columns', async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string; nullable: string }>>`
      SELECT column_name AS name, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_name = 'DiagnosisSession' AND column_name LIKE 'fixConfirmation%'
      ORDER BY column_name
    `;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.nullable === 'YES')).toBe(true);
  });

  it('has the test-database sentinel marker', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "_fixit_test_sentinel"
      WHERE marker = 'fixit-test-phase4a'
    `;
    expect(rows[0]?.count).toBe(1);
  });

  it('has empty application tables', async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string; count: number }>>`
      SELECT 'User' AS name, count(*)::int AS count FROM "User"
      UNION ALL SELECT 'RefreshToken', count(*)::int FROM "RefreshToken"
      UNION ALL SELECT 'Appliance', count(*)::int FROM "Appliance"
      UNION ALL SELECT 'KnowledgeSource', count(*)::int FROM "KnowledgeSource"
      UNION ALL SELECT 'ErrorCode', count(*)::int FROM "ErrorCode"
      UNION ALL SELECT 'RepairStep', count(*)::int FROM "RepairStep"
      UNION ALL SELECT 'ErrorCodeRepairStep', count(*)::int FROM "ErrorCodeRepairStep"
      UNION ALL SELECT 'DiagnosisSession', count(*)::int FROM "DiagnosisSession"
      UNION ALL SELECT 'Message', count(*)::int FROM "Message"
    `;
    expect(rows.every((row) => row.count === 0)).toBe(true);
  });
});
