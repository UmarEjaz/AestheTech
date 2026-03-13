import Redis from "ioredis";

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
  if (client && process.env.NODE_ENV !== "production") {
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

export async function invalidateDashboardCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const [dashboardKeys, reportKeys] = await Promise.all([
      redis.keys("dashboard:*"),
      redis.keys("reports:*"),
    ]);

    const allKeys = [...dashboardKeys, ...reportKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  } catch {
    // Silent failure
  }
}
