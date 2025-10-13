import Redis from 'ioredis'

// Redis connection with optimized settings for high RPS
export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  // Connection pool settings for high RPS
  connectTimeout: 10000,
  commandTimeout: 5000,
  // Keep connections alive
  keepAlive: 30000,
})

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err)
})

redis.on('connect', () => {
  console.log('[Redis] Connected successfully')
})

/**
 * Cache helper with automatic expiration
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const cached = await redis.get(key)
    return cached ? JSON.parse(cached) : null
  } catch (err) {
    console.error('[Redis] Get error:', err)
    return null
  }
}

export async function cacheSet(key: string, value: any, ttlSeconds: number = 60): Promise<void> {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
  } catch (err) {
    console.error('[Redis] Set error:', err)
  }
}

/**
 * Get TTL from environment or use default
 */
export function getTTL(key: 'dashboard' | 'submerchants' | 'withdrawals', defaultTTL: number = 60): number {
  const envKey = `CACHE_${key.toUpperCase()}_TTL`
  const envValue = process.env[envKey]
  return envValue ? parseInt(envValue, 10) : defaultTTL
}

/**
 * Cache wrapper with automatic TTL from env
 */
export async function cacheWrapper<T>(
  key: string,
  ttlType: 'dashboard' | 'submerchants' | 'withdrawals',
  fetchFn: () => Promise<T>
): Promise<T> {
  // Try to get from cache
  const cached = await cacheGet<T>(key)
  if (cached !== null) {
    return cached
  }

  // Fetch fresh data
  const data = await fetchFn()

  // Store in cache with TTL from env
  const ttl = getTTL(ttlType)
  await cacheSet(key, data, ttl)

  return data
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key)
  } catch (err) {
    console.error('[Redis] Del error:', err)
  }
}

/**
 * Pattern-based cache invalidation
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch (err) {
    console.error('[Redis] Del pattern error:', err)
  }
}