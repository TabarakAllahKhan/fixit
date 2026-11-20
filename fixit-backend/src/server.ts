import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { app } from './app.js';

const PORT = env.PORT;

const server = app.listen(PORT, () => {
  console.log(`FixIt API is running on port ${PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error(
        'Prisma disconnect failed:',
        disconnectError instanceof Error ? disconnectError.message : disconnectError,
      );
    } finally {
      clearTimeout(forceExit);
      if (error) {
        console.error('HTTP server close failed:', error.message);
        process.exitCode = 1;
      }
    }
  });
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
