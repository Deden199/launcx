// src/core/monitoring.service.ts
/**
 * MONITORING AND BENCHMARKING SERVICE
 *
 * Features:
 * - Real-time performance metrics
 * - Cache hit rate tracking
 * - CPU and memory profiling
 * - Query performance analysis
 * - Automated alerting
 * - Dashboard metrics export
 */

import logger from '../logger'

/**
 * Performance Metrics Interface
 */
export interface PerformanceMetrics {
  timestamp: Date
  cpu: number // percentage
  memory: {
    heapUsed: number
    heapTotal: number
    external: number
    rss: number
  }
  cacheMetrics: {
    hitRate: number
    hits: number
    misses: number
    totalRequests: number
  }
  queryMetrics: {
    totalQueries: number
    avgQueryTime: number
    slowQueries: number
    slowQueryThreshold: number
  }
  apiMetrics: {
    totalRequests: number
    avgResponseTime: number
    errorRate: number
    p95ResponseTime: number
    p99ResponseTime: number
  }
}

/**
 * Alert Configuration
 */
export interface AlertConfig {
  cpuThreshold: number // percentage
  memoryThreshold: number // MB
  cacheHitRateThreshold: number // percentage
  queryTimeThreshold: number // ms
  errorRateThreshold: number // percentage
}

/**
 * Monitoring Service
 */
class MonitoringService {
  private metrics: PerformanceMetrics[] = []
  private alertConfig: AlertConfig
  private isCollecting = false
  private collectionInterval: NodeJS.Timeout | null = null
  private maxMetricsHistory: number = 1440 // 24 hours of minute-level metrics

  // Metrics tracking
  private queryStats: Map<string, { count: number; totalTime: number; slowCount: number }> = new Map()
  private apiStats: Map<string, { count: number; totalTime: number; errors: number; responseTimes: number[] }> = new Map()
  private requestStartTimes: Map<string, number> = new Map()

  constructor(alertConfig: Partial<AlertConfig> = {}) {
    this.alertConfig = {
      cpuThreshold: alertConfig.cpuThreshold || 70,
      memoryThreshold: alertConfig.memoryThreshold || 500,
      cacheHitRateThreshold: alertConfig.cacheHitRateThreshold || 70,
      queryTimeThreshold: alertConfig.queryTimeThreshold || 100,
      errorRateThreshold: alertConfig.errorRateThreshold || 1,
    }

    logger.info('[Monitoring] Service initialized', this.alertConfig)
  }

  /**
   * Start collecting metrics at regular intervals
   */
  startCollecting(intervalMs: number = 60000): void {
    if (this.isCollecting) return

    this.isCollecting = true

    this.collectionInterval = setInterval(() => {
      this.collectMetrics()
    }, intervalMs)

    logger.info('[Monitoring] Metrics collection started', { intervalMs })
  }

  /**
   * Stop collecting metrics
   */
  stopCollecting(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval)
      this.collectionInterval = null
    }

    this.isCollecting = false
    logger.info('[Monitoring] Metrics collection stopped')
  }

  /**
   * Collect current metrics snapshot
   */
  private collectMetrics(): void {
    const metrics: PerformanceMetrics = {
      timestamp: new Date(),
      cpu: this.getCPUUsage(),
      memory: this.getMemoryMetrics(),
      cacheMetrics: this.getCacheMetrics(),
      queryMetrics: this.getQueryMetrics(),
      apiMetrics: this.getAPIMetrics(),
    }

    this.metrics.push(metrics)

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory)
    }

    // Check for alerts
    this.checkAlerts(metrics)

    logger.debug('[Monitoring] Metrics collected', {
      cpu: metrics.cpu.toFixed(2) + '%',
      memory: metrics.memory.heapUsed + 'MB',
      cacheHitRate: metrics.cacheMetrics.hitRate.toFixed(2) + '%',
    })
  }

  /**
   * Track query execution
   */
  trackQuery(queryName: string, durationMs: number, isError: boolean = false): void {
    if (!this.queryStats.has(queryName)) {
      this.queryStats.set(queryName, { count: 0, totalTime: 0, slowCount: 0 })
    }

    const stats = this.queryStats.get(queryName)!
    stats.count++
    stats.totalTime += durationMs

    if (durationMs > this.alertConfig.queryTimeThreshold) {
      stats.slowCount++
    }
  }

  /**
   * Track API request
   */
  trackAPIRequest(endpoint: string, durationMs: number, statusCode: number): void {
    if (!this.apiStats.has(endpoint)) {
      this.apiStats.set(endpoint, { count: 0, totalTime: 0, errors: 0, responseTimes: [] })
    }

    const stats = this.apiStats.get(endpoint)!
    stats.count++
    stats.totalTime += durationMs
    stats.responseTimes.push(durationMs)

    // Keep only recent response times for percentile calculation
    if (stats.responseTimes.length > 1000) {
      stats.responseTimes = stats.responseTimes.slice(-1000)
    }

    if (statusCode >= 400) {
      stats.errors++
    }
  }

  /**
   * Get current CPU usage (simplified)
   */
  private getCPUUsage(): number {
    const usage = process.cpuUsage()
    // Convert to percentage (rough estimate)
    return Math.min(100, ((usage.user + usage.system) / 1000000) * 10)
  }

  /**
   * Get memory metrics
   */
  private getMemoryMetrics() {
    const mem = process.memoryUsage()
    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
    }
  }

  /**
   * Get cache metrics (placeholder - integrate with CacheService)
   */
  private getCacheMetrics() {
    return {
      hitRate: 80,
      hits: 0,
      misses: 0,
      totalRequests: 0,
    }
  }

  /**
   * Get query metrics
   */
  private getQueryMetrics() {
    let totalQueries = 0
    let totalTime = 0
    let slowQueries = 0

    for (const stats of this.queryStats.values()) {
      totalQueries += stats.count
      totalTime += stats.totalTime
      slowQueries += stats.slowCount
    }

    const avgQueryTime = totalQueries > 0 ? totalTime / totalQueries : 0

    return {
      totalQueries,
      avgQueryTime: Math.round(avgQueryTime),
      slowQueries,
      slowQueryThreshold: this.alertConfig.queryTimeThreshold,
    }
  }

  /**
   * Get API metrics
   */
  private getAPIMetrics() {
    let totalRequests = 0
    let totalTime = 0
    let totalErrors = 0
    const allResponseTimes: number[] = []

    for (const stats of this.apiStats.values()) {
      totalRequests += stats.count
      totalTime += stats.totalTime
      totalErrors += stats.errors
      allResponseTimes.push(...stats.responseTimes)
    }

    const avgResponseTime = totalRequests > 0 ? totalTime / totalRequests : 0
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0

    // Calculate percentiles
    const sorted = [...allResponseTimes].sort((a, b) => a - b)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0

    return {
      totalRequests,
      avgResponseTime: Math.round(avgResponseTime),
      errorRate: Math.round(errorRate * 100) / 100,
      p95ResponseTime: p95,
      p99ResponseTime: p99,
    }
  }

  /**
   * Check for alert conditions
   */
  private checkAlerts(metrics: PerformanceMetrics): void {
    const alerts: string[] = []

    if (metrics.cpu > this.alertConfig.cpuThreshold) {
      alerts.push(
        `[CPU ALERT] Usage ${metrics.cpu.toFixed(2)}% exceeds threshold ${this.alertConfig.cpuThreshold}%`
      )
    }

    if (metrics.memory.heapUsed > this.alertConfig.memoryThreshold) {
      alerts.push(
        `[MEMORY ALERT] Heap usage ${metrics.memory.heapUsed}MB exceeds threshold ${this.alertConfig.memoryThreshold}MB`
      )
    }

    if (metrics.cacheMetrics.hitRate < this.alertConfig.cacheHitRateThreshold) {
      alerts.push(
        `[CACHE ALERT] Hit rate ${metrics.cacheMetrics.hitRate.toFixed(2)}% below threshold ${this.alertConfig.cacheHitRateThreshold}%`
      )
    }

    if (metrics.queryMetrics.avgQueryTime > this.alertConfig.queryTimeThreshold) {
      alerts.push(
        `[QUERY ALERT] Average query time ${metrics.queryMetrics.avgQueryTime}ms exceeds threshold ${this.alertConfig.queryTimeThreshold}ms`
      )
    }

    if (metrics.apiMetrics.errorRate > this.alertConfig.errorRateThreshold) {
      alerts.push(
        `[ERROR ALERT] Error rate ${metrics.apiMetrics.errorRate}% exceeds threshold ${this.alertConfig.errorRateThreshold}%`
      )
    }

    for (const alert of alerts) {
      logger.warn('[Monitoring] ' + alert)
    }
  }

  /**
   * Get latest metrics
   */
  getLatestMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(minutes: number = 60): PerformanceMetrics[] {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000)
    return this.metrics.filter(m => m.timestamp > cutoffTime)
  }

  /**
   * Get top slow queries
   */
  getTopSlowQueries(limit: number = 10): Array<{
    query: string
    count: number
    avgTime: number
    slowCount: number
  }> {
    const queries = Array.from(this.queryStats.entries())
      .map(([query, stats]) => ({
        query,
        count: stats.count,
        avgTime: stats.count > 0 ? Math.round(stats.totalTime / stats.count) : 0,
        slowCount: stats.slowCount,
      }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, limit)

    return queries
  }

  /**
   * Get top slow endpoints
   */
  getTopSlowEndpoints(limit: number = 10): Array<{
    endpoint: string
    count: number
    avgTime: number
    errorRate: number
  }> {
    const endpoints = Array.from(this.apiStats.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        count: stats.count,
        avgTime: stats.count > 0 ? Math.round(stats.totalTime / stats.count) : 0,
        errorRate:
          stats.count > 0 ? Math.round(((stats.errors / stats.count) * 100) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, limit)

    return endpoints
  }

  /**
   * Generate performance report
   */
  generateReport(): {
    summary: PerformanceMetrics | null
    slowQueries: any[]
    slowEndpoints: any[]
    recommendations: string[]
  } {
    const latest = this.getLatestMetrics()
    const slowQueries = this.getTopSlowQueries(5)
    const slowEndpoints = this.getTopSlowEndpoints(5)
    const recommendations: string[] = []

    // Generate recommendations
    if (latest) {
      if (latest.cpu > 60) {
        recommendations.push('Consider implementing query batching to reduce CPU usage')
      }

      if (latest.memory.heapUsed > 400) {
        recommendations.push('Memory usage is high - review data streaming and caching strategies')
      }

      if (latest.cacheMetrics.hitRate < 70) {
        recommendations.push('Cache hit rate is low - check TTL settings and access patterns')
      }

      if (latest.queryMetrics.avgQueryTime > 100) {
        recommendations.push(
          'Average query time is high - add database indexes for slow queries'
        )
      }

      if (latest.apiMetrics.errorRate > 1) {
        recommendations.push('Error rate is elevated - check error logs and API dependencies')
      }
    }

    return {
      summary: latest,
      slowQueries,
      slowEndpoints,
      recommendations,
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = []
    this.queryStats.clear()
    this.apiStats.clear()
    this.requestStartTimes.clear()

    logger.info('[Monitoring] Metrics reset')
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify({
      collected: this.metrics,
      summary: this.getLatestMetrics(),
      report: this.generateReport(),
    })
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopCollecting()
    this.reset()

    logger.info('[Monitoring] Service destroyed')
  }
}

export default MonitoringService
