import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prismaPgAdapter?: PrismaPg;
  prismaPgPool?: Pool;
  prisma?: PrismaClient;
};

function getRuntimeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Prisma runtime queries.");
  }

  return databaseUrl;
}

function getPrismaPgPool() {
  if (globalForPrisma.prismaPgPool) {
    return globalForPrisma.prismaPgPool;
  }

  // Keep the serverless pool intentionally tiny so each warm Vercel instance
  // holds at most a very small number of Postgres connections.
  const pool = new Pool({
    connectionString: getRuntimeDatabaseUrl(),
    max: Number(process.env.PRISMA_SERVERLESS_POOL_MAX ?? "1"),
    idleTimeoutMillis: 30_000
  });

  globalForPrisma.prismaPgPool = pool;
  return pool;
}

function getPrismaPgAdapter() {
  if (globalForPrisma.prismaPgAdapter) {
    return globalForPrisma.prismaPgAdapter;
  }

  const adapter = new PrismaPg(getPrismaPgPool());
  globalForPrisma.prismaPgAdapter = adapter;
  return adapter;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: getPrismaPgAdapter(),
    log: ["error"]
  });
}

export function getPrisma() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

// Reuse one Prisma client per runtime process to avoid opening fresh database
// connections on every import, hot reload, or warm serverless invocation.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, newValue) {
    const client = getPrisma();
    return Reflect.set(client, property, newValue);
  }
});
