import { prisma } from "../config/prisma.js";

async function main() {
  try {
    const result = await prisma.$queryRaw`
      SELECT 1 AS connection_test
    `;

    console.log("Prisma database connection successful!");
    console.log(result);
  } catch (error) {
    console.error("Prisma database connection failed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();