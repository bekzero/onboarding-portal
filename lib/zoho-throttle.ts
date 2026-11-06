import "server-only";

import { Prisma, type ZohoApiOperation } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const LIMITS: Record<ZohoApiOperation, number> = { CONTACT_SYNC: 500, JOURNEY_TRIGGER: 100 };
const WINDOW_MS = 5 * 60_000;

export async function reserveZohoApiCapacity(operation: ZohoApiOperation, now = new Date()) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`zoho-throttle:${operation}`}, 0))`);
    const current = await transaction.zohoApiThrottle.upsert({
      where: { operation }, create: { operation, windowStartedAt: now }, update: {}
    });
    if (current.blockedUntil && current.blockedUntil > now) {
      return { allowed: false as const, retryAt: current.blockedUntil };
    }
    const expired = !current.windowStartedAt || now.getTime() - current.windowStartedAt.getTime() >= WINDOW_MS;
    const count = expired ? 0 : current.requestCount;
    if (count >= LIMITS[operation]) {
      const retryAt = new Date(now.getTime() + 30 * 60_000);
      await transaction.zohoApiThrottle.update({ where: { operation }, data: { blockedUntil: retryAt, version: { increment: 1 } } });
      return { allowed: false as const, retryAt };
    }
    await transaction.zohoApiThrottle.update({
      where: { operation },
      data: { blockedUntil: null, requestCount: count + 1, windowStartedAt: expired ? now : current.windowStartedAt, version: { increment: 1 } }
    });
    return { allowed: true as const };
  });
}

export function blockZohoApi(operation: ZohoApiOperation, until: Date) {
  return prisma.zohoApiThrottle.upsert({
    where: { operation },
    create: { operation, blockedUntil: until },
    update: { blockedUntil: until, version: { increment: 1 } }
  });
}
