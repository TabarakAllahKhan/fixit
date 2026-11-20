import { env } from './env.js';
import { prisma } from './prisma.js';

// Readiness probes must fail quickly instead of holding a request open while a
// database query hangs. The underlying query is not cancelled, but the caller
// receives a bounded response.
export async function checkDatabase(timeoutMs = env.HEALTH_CHECK_TIMEOUT_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database check timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
