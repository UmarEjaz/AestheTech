import Redis from "ioredis";
import { prisma } from "@/lib/prisma";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    client.on("error", (err) => {
      console.error("Redis connection error:", err.message);
    });

    return client;
  } catch {
    return null;
  }
}

export function getRedis(): Redis | null {
  if (globalForRedis.redis) return globalForRedis.redis;

  const client = createRedisClient();
  if (client) {
    globalForRedis.redis = client;
  }

  return client;
}

// ISO 8601 date string pattern
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (!raw) return null;

    return JSON.parse(raw, (_key, value) => {
      if (typeof value === "string" && ISO_DATE_RE.test(value)) {
        return new Date(value);
      }
      return value;
    }) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, data: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch {
    // Silent failure — app works without cache
  }
}

async function scanAndDelete(redis: Redis, pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.unlink(...keys);
    }
  } while (cursor !== "0");
}

export async function invalidateDashboardCache(salonId?: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    if (salonId) {
      // Invalidate this salon's branch-specific cache
      await Promise.all([
        scanAndDelete(redis, `salon:${salonId}:dashboard:*`),
        scanAndDelete(redis, `salon:${salonId}:reports:*`),
      ]);
      // Also invalidate org-level caches (covers the "all branches" view)
      const salon = await prisma.salon.findUnique({
        where: { id: salonId },
        select: { parentSalonId: true },
      });
      const orgRootId = salon?.parentSalonId || salonId;
      await Promise.all([
        scanAndDelete(redis, `org:${orgRootId}:dashboard:*`),
        scanAndDelete(redis, `org:${orgRootId}:reports:*`),
      ]);
    } else {
      // Fallback: invalidate all caches
      await Promise.all([
        scanAndDelete(redis, "salon:*:dashboard:*"),
        scanAndDelete(redis, "salon:*:reports:*"),
        scanAndDelete(redis, "org:*:dashboard:*"),
        scanAndDelete(redis, "org:*:reports:*"),
      ]);
    }
  } catch {
    // Silent failure
  }
}
