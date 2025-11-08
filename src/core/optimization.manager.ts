// src/core/optimization.manager.ts
/**
 * OPTIMIZATION MANAGER
 *
 * Central hub for all optimization services:
 * - Cache Service (multi-tier caching with invalidation)
 * - CPU Optimization (query batching, deduplication)
 * - RAM Optimization (object pooling, streaming)
 * - Monitoring Service (metrics, alerts, reporting)
 *
 * Provides unified interface for dashboard controllers
 * and other services to leverage all optimizations.
 */

import CacheService from './cache.service'
import CPUOptimizationService from './cpu.optimization'
import RAMOptimizationService from './ram.optimization'
import MonitoringService from './monitoring.service'
import { Redis } from 'ioredis'
import logger from '../logger'

/**
 * Optimization Manager Configuration
 */
export interface OptimizationConfig {
  cacheConfig?: any
  cpuConfig?: any
  ramConfig?: any
  monitoringConfig?: any
}

/**
 * Dashboard Query Context (for optimization tracking)
 */
export interface QueryContext {
  queryId: string
  endpoint: string
  userId?: string
  merchantId?: string
  startTime: number
  duration?: number
  cached?: boolean
  error?: boolean
}

/**
 * Optimization Manager (Main Service)
 */
class OptimizationManager {
  private cacheService: CacheService
  private cpuService: CPUOptimizationService
  private ramService: RAMOptimizationService
  private monitoringService: MonitoringService
  private queryContexts: Map<string, QueryContext> = new Map()
  private redis: Redis

  constructor(redis: Redis, config: OptimizationConfig = {}) {
    this.redis = redis

    // Initialize all services
    this.cacheService = new CacheService(redis, config.cacheConfig)
    this.cpuService = new CPUOptimizationService(config.cpuConfig)
    this.ramService = new RAMOptimizationService()
    this.monitoringService = new MonitoringService(config.monitoringConfig)

    // Start monitoring
    this.monitoringService.startCollecting(60000) // Collect metrics every minute

    logger.info('[OptimizationManager] Initialized with all services', {
      services: ['cache', 'cpu', 'ram', 'monitoring'],
    })
  }

  /**
   * Get cache service for direct usage
   */
  getCache(): CacheService {
    return this.cacheService
  }

  /**
   * Get CPU optimization service
   */
  getCPU(): CPUOptimizationService {
    return this.cpuService
  }

  /**
   * Get RAM optimization service
   */
  getRAM(): RAMOptimizationService {
    return this.ramService
  }

  /**
   * Get monitoring service
   */
  getMonitoring(): MonitoringService {
    return this.monitoringService
  }

  /**
   * Optimized Query Execution with All Services
   * Combines caching, deduplication, and monitoring
   *
   * Usage:
   *   const result = await optimizationManager.executeOptimized({
   *     endpoint: 'getDashboardStats',
   *     queryId: `stats-${merchantId}`,
   *     cacheTTL: 300,
   *     query: async () => fetchStats()
   *   })
   */
  async executeOptimized<T>(opts: {
    endpoint: string
    queryId: string
    query: () => Promise<T>
    cacheTTL?: number
    userId?: string
    merchantId?: string
    bypassCache?: boolean
  }): Promise<T> {
    const context: QueryContext = {
      queryId: opts.queryId,
      endpoint: opts.endpoint,
      userId: opts.userId,
      merchantId: opts.merchantId,
      startTime: Date.now(),
    }

    try {
      // Try cache first (unless bypassed)
      if (!opts.bypassCache) {
        const cached = await this.cacheService.get<T>(opts.queryId)
        if (cached !== null) {
          context.duration = Date.now() - context.startTime
          context.cached = true
          this.monitoringService.trackAPIRequest(opts.endpoint, context.duration, 200)

          logger.debug('[OptimizationManager] Cache hit', {
            queryId: opts.queryId,
            duration: context.duration,
          })

          return cached
        }
      }

      // Execute with deduplication (prevents concurrent request duplication)
      const result = await this.cpuService.dedupQuery(opts.queryId, opts.query)

      // Store in cache
      if (opts.cacheTTL) {
        await this.cacheService.set(opts.queryId, result, opts.cacheTTL)
      }

      context.duration = Date.now() - context.startTime
      context.cached = false
      this.monitoringService.trackAPIRequest(opts.endpoint, context.duration, 200)

      logger.info('[OptimizationManager] Query executed', {
        queryId: opts.queryId,
        duration: context.duration,
        cached: false,
      })

      return result
    } catch (error) {
      context.duration = Date.now() - context.startTime
      context.error = true

      this.monitoringService.trackAPIRequest(opts.endpoint, context.duration, 500)

      logger.error('[OptimizationManager] Query failed', {
        queryId: opts.queryId,
        duration: context.duration,
        error,
      })

      throw error
    }
  }

  /**
   * Batch Query Execution with Optimization
   *
   * Usage:
   *   const results = await optimizationManager.executeBatchOptimized({
   *     endpoint: 'getBatchOrders',
   *     queries: [
   *       { id: 'order-1', query: () => fetchOrder('1') },
   *       { id: 'order-2', query: () => fetchOrder('2') }
   *     ]
   *   })
   */
  async executeBatchOptimized<T>(opts: {
    endpoint: string
    queries: Array<{ id: string; query: () => Promise<T> }>
    cacheTTL?: number
  }): Promise<T[]> {
    const startTime = Date.now()

    // Execute all queries in parallel with individual caching
    const promises = opts.queries.map(({ id, query }) =>
      this.executeOptimized({
        endpoint: opts.endpoint,
        queryId: id,
        query,
        cacheTTL: opts.cacheTTL,
      })
    )

    const results = await Promise.all(promises)

    const duration = Date.now() - startTime

    logger.info('[OptimizationManager] Batch execution completed', {
      endpoint: opts.endpoint,
      count: opts.queries.length,
      duration,
      avgTime: (duration / opts.queries.length).toFixed(2) + 'ms',
    })

    return results
  }

  /**
   * Streaming Query with RAM Optimization
   * Prevents memory spikes for large result sets
   *
   * Usage:
   *   const processor = async (batch) => {
   *     return batch.map(item => transform(item))
   *   }
   *   await optimizationManager.executeStreaming({
   *     endpoint: 'exportOrders',
   *     source: ordersGenerator(),
   *     processor,
   *     onBatch: async (results) => { ... }
   *   })
   */
  async executeStreaming<T, R>(opts: {
    endpoint: string
    source: AsyncIterable<T[]>
    processor: (items: T[]) => Promise<R[]>
    onBatch?: (results: R[], batchNum: number) => Promise<void>
  }): Promise<R[]> {
    const startTime = Date.now()

    const results = await this.ramService.getStreamingProcessor().processStream(
      opts.source,
      opts.processor,
      opts.onBatch
    )

    const duration = Date.now() - startTime

    this.monitoringService.trackAPIRequest(opts.endpoint, duration, 200)

    logger.info('[OptimizationManager] Streaming completed', {
      endpoint: opts.endpoint,
      totalItems: results.length,
      duration,
    })

    return results
  }

  /**
   * Invalidate Cache Pattern
   * Called when data is modified
   *
   * Usage:
   *   await optimizationManager.invalidateCache('stats:merchant:*')
   */
  async invalidateCache(pattern: string): Promise<void> {
    const count = await this.cacheService.invalidate(pattern, true)

    logger.info('[OptimizationManager] Cache invalidated', {
      pattern,
      keysDeleted: count,
    })
  }

  /**
   * Get Health Status of All Services
   */
  async getHealthStatus(): Promise<{
    cache: { status: string; stats: any }
    cpu: { status: string; connectionStats: any }
    ram: { status: string; poolStats: any }
    monitoring: { status: string; metrics: any }
  }> {
    return {
      cache: {
        status: 'healthy',
        stats: this.cacheService.getStats(),
      },
      cpu: {
        status: 'healthy',
        connectionStats: await this.cpuService.getConnectionStats(),
      },
      ram: {
        status: 'healthy',
        poolStats: this.ramService.getPoolStats(),
      },
      monitoring: {
        status: 'healthy',
        metrics: this.monitoringService.getLatestMetrics(),
      },
    }
  }

  /**
   * Get Performance Report
   */
  getPerformanceReport(): any {
    return {
      cache: this.cacheService.getStats(),
      monitoring: this.monitoringService.generateReport(),
      slowQueries: this.monitoringService.getTopSlowQueries(10),
      slowEndpoints: this.monitoringService.getTopSlowEndpoints(10),
    }
  }

  /**
   * Reset All Metrics
   */
  resetMetrics(): void {
    this.cacheService.resetStats()
    this.monitoringService.reset()

    logger.info('[OptimizationManager] All metrics reset')
  }

  /**
   * Cleanup and Shutdown
   */
  async destroy(): Promise<void> {
    logger.info('[OptimizationManager] Starting cleanup...')

    this.cpuService.destroy()
    this.ramService.destroy()
    this.monitoringService.destroy()
    await this.cacheService.clear()

    this.queryContexts.clear()

    logger.info('[OptimizationManager] All services cleaned up')
  }
}

export default OptimizationManager
