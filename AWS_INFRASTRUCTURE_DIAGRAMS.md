# AWS Infrastructure Diagrams & Visual Topology

## 1. High-Level Architecture Diagram

```
                                    ┌─────────────────────────────────────────┐
                                    │          USERS (5M Concurrent)          │
                                    │     Indonesia, Singapore, Malaysia      │
                                    └────────────────┬────────────────────────┘
                                                     │
                                                     │ HTTPS
                                                     ▼
                    ┌────────────────────────────────────────────────────────────────┐
                    │                    AWS GLOBAL EDGE LAYER                       │
                    │  ╔═══════════════════════════════════════════════════════╗    │
                    │  ║        CloudFront CDN (450+ Edge Locations)           ║    │
                    │  ║  • DDoS Protection (Shield Standard)                  ║    │
                    │  ║  • SSL/TLS Termination                                ║    │
                    │  ║  • Static Asset Caching (24h TTL)                     ║    │
                    │  ║  • Gzip/Brotli Compression                            ║    │
                    │  ║  • WAF Rules (Rate Limiting, SQL Injection)           ║    │
                    │  ╚═══════════════════════════════════════════════════════╝    │
                    │                              │                                 │
                    │                              │                                 │
                    │  ╔═══════════════════════════▼═══════════════════════════╗    │
                    │  ║              Route 53 (DNS & Routing)                 ║    │
                    │  ║  • Latency-based routing                              ║    │
                    │  ║  • Health checks (30s interval)                       ║    │
                    │  ║  • Failover to DR region                              ║    │
                    │  ╚═══════════════════════════════════════════════════════╝    │
                    └────────────────────────────────────────────────────────────────┘
                                                     │
                                                     │
                                                     ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                         AWS REGION: ap-southeast-1 (Singapore)                                 │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                           VPC: 10.0.0.0/16 (65,536 IPs)                               │    │
│  │                                                                                        │    │
│  │  ╔═════════════════════════════════════════════════════════════════════════════╗     │    │
│  │  ║                        PUBLIC SUBNET TIER                                   ║     │    │
│  │  ║  (3 AZs: 10.0.1.0/24, 10.0.2.0/24, 10.0.3.0/24)                             ║     │    │
│  │  ╠═════════════════════════════════════════════════════════════════════════════╣     │    │
│  │  ║                                                                             ║     │    │
│  │  ║   ┌───────────────────────────────────────────────────────────────┐        ║     │    │
│  │  ║   │     Application Load Balancer (ALB)                           │        ║     │    │
│  │  ║   │  ┌─────────────────────────────────────────────────────────┐ │        ║     │    │
│  │  ║   │  │  • SSL Offloading (ACM Certificate)                     │ │        ║     │    │
│  │  ║   │  │  • HTTP/2 Enabled                                       │ │        ║     │    │
│  │  ║   │  │  • Connection Multiplexing                              │ │        ║     │    │
│  │  ║   │  │  • Sticky Sessions (1 hour)                             │ │        ║     │    │
│  │  ║   │  │  • Health Checks (/health every 30s)                    │ │        ║     │    │
│  │  ║   │  │  • Capacity: 100K conn/AZ (300K total)                  │ │        ║     │    │
│  │  ║   │  └─────────────────────────────────────────────────────────┘ │        ║     │    │
│  │  ║   └──────────────────────────────┬────────────────────────────────┘        ║     │    │
│  │  ║                                   │                                         ║     │    │
│  │  ╚═══════════════════════════════════▼═════════════════════════════════════════╝     │    │
│  │                                      │                                                │    │
│  │  ╔═══════════════════════════════════▼═════════════════════════════════════════╗     │    │
│  │  ║                       PRIVATE SUBNET TIER                                   ║     │    │
│  │  ║  (3 AZs: 10.0.10.0/24, 10.0.11.0/24, 10.0.12.0/24)                          ║     │    │
│  │  ╠═════════════════════════════════════════════════════════════════════════════╣     │    │
│  │  ║                                                                             ║     │    │
│  │  ║   ┌──────────────────────────────────────────────────────────────────┐     ║     │    │
│  │  ║   │           ECS FARGATE CLUSTER (Auto-Scaling)                     │     ║     │    │
│  │  ║   │  ┌────────────────────────────────────────────────────────────┐ │     ║     │    │
│  │  ║   │  │  Tasks: 10 (min) → 1000 (max)                              │ │     ║     │    │
│  │  ║   │  │  Per Task: 4 vCPU, 8GB RAM                                 │ │     ║     │    │
│  │  ║   │  │  Capacity: 5,000 req/task                                  │ │     ║     │    │
│  │  ║   │  │                                                            │ │     ║     │    │
│  │  ║   │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │     ║     │    │
│  │  ║   │  │  │  Task 1  │  │  Task 2  │  │   ...    │  │ Task 1000│  │ │     ║     │    │
│  │  ║   │  │  │  Node.js │  │  Node.js │  │          │  │  Node.js │  │ │     ║     │    │
│  │  ║   │  │  │  Express │  │  Express │  │          │  │  Express │  │ │     ║     │    │
│  │  ║   │  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │ │     ║     │    │
│  │  ║   │  └───────┼──────────────┼──────────────┼──────────────┼───────┘ │     ║     │    │
│  │  ║   └──────────┼──────────────┼──────────────┼──────────────┼─────────┘     ║     │    │
│  │  ║              │              │              │              │               ║     │    │
│  │  ║              └──────────────┴──────────────┴──────────────┘               ║     │    │
│  │  ║                                   │                                        ║     │    │
│  │  ║                                   │                                        ║     │    │
│  │  ║              ┌────────────────────┴────────────────────┐                   ║     │    │
│  │  ║              │                                         │                   ║     │    │
│  │  ║              ▼                                         ▼                   ║     │    │
│  │  ║   ┌─────────────────────────┐               ┌─────────────────────────┐   ║     │    │
│  │  ║   │  ElastiCache Redis      │               │  MongoDB Replica Set    │   ║     │    │
│  │  ║   │  (Cluster Mode)         │               │  (Self-Hosted EC2)      │   ║     │    │
│  │  ║   │                         │               │                         │   ║     │    │
│  │  ║   │  ┌─────────────────┐   │               │  ┌───────────────────┐  │   ║     │    │
│  │  ║   │  │  Shard 1        │   │               │  │  Primary (AZ-A)   │  │   ║     │    │
│  │  ║   │  │  52GB r7g.2xl   │   │               │  │  r6g.2xlarge      │  │   ║     │    │
│  │  ║   │  │  + 2 Replicas   │   │               │  │  8 vCPU, 64GB     │  │   ║     │    │
│  │  ║   │  └─────────────────┘   │               │  │  2TB gp3 SSD      │  │   ║     │    │
│  │  ║   │                         │               │  └───────────────────┘  │   ║     │    │
│  │  ║   │  ┌─────────────────┐   │               │           │             │   ║     │    │
│  │  ║   │  │  Shard 2        │   │               │           ▼             │   ║     │    │
│  │  ║   │  │  52GB r7g.2xl   │   │               │  ┌───────────────────┐  │   ║     │    │
│  │  ║   │  │  + 2 Replicas   │   │               │  │ Secondary (AZ-B)  │  │   ║     │    │
│  │  ║   │  └─────────────────┘   │               │  │  r6g.2xlarge      │  │   ║     │    │
│  │  ║   │                         │               │  │  8 vCPU, 64GB     │  │   ║     │    │
│  │  ║   │  ┌─────────────────┐   │               │  │  2TB gp3 SSD      │  │   ║     │    │
│  │  ║   │  │  Shard 3        │   │               │  └───────────────────┘  │   ║     │    │
│  │  ║   │  │  52GB r7g.2xl   │   │               │           │             │   ║     │    │
│  │  ║   │  │  + 2 Replicas   │   │               │           ▼             │   ║     │    │
│  │  ║   │  └─────────────────┘   │               │  ┌───────────────────┐  │   ║     │    │
│  │  ║   │                         │               │  │ Secondary (AZ-C)  │  │   ║     │    │
│  │  ║   │  Total: 9 nodes         │               │  │  r6g.2xlarge      │  │   ║     │    │
│  │  ║   │  Capacity: 1.5M ops/s   │               │  │  8 vCPU, 64GB     │  │   ║     │    │
│  │  ║   └─────────────────────────┘               │  │  2TB gp3 SSD      │  │   ║     │    │
│  │  ║                                             │  └───────────────────┘  │   ║     │    │
│  │  ║                                             │                         │   ║     │    │
│  │  ║                                             │  ┌───────────────────┐  │   ║     │    │
│  │  ║                                             │  │ Arbiter (AZ-A)    │  │   ║     │    │
│  │  ║                                             │  │  t4g.small        │  │   ║     │    │
│  │  ║                                             │  └───────────────────┘  │   ║     │    │
│  │  ║                                             └─────────────────────────┘   ║     │    │
│  │  ╚═════════════════════════════════════════════════════════════════════════════╝     │    │
│  │                                                                                        │    │
│  │  ╔═════════════════════════════════════════════════════════════════════════════╗     │    │
│  │  ║                         SUPPORTING SERVICES                                 ║     │    │
│  │  ╠═════════════════════════════════════════════════════════════════════════════╣     │    │
│  │  ║                                                                             ║     │    │
│  │  ║   • S3 (Backups, Static Assets, Logs)                                      ║     │    │
│  │  ║   • Secrets Manager (API Keys, Credentials)                                ║     │    │
│  │  ║   • CloudWatch (Logs, Metrics, Alarms)                                     ║     │    │
│  │  ║   • KMS (Encryption Keys)                                                  ║     │    │
│  │  ║   • ECR (Docker Registry)                                                  ║     │    │
│  │  ║   • Systems Manager (Parameter Store)                                      ║     │    │
│  │  ║                                                                             ║     │    │
│  │  ╚═════════════════════════════════════════════════════════════════════════════╝     │    │
│  └──────────────────────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Request Flow Diagram (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           REQUEST FLOW: Payment Creation                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Client App                                                    Launcx Backend
   (5M Users)                                                    (AWS Infrastructure)
       │
       │ 1. POST /api/v1/payments/create
       │    Headers: X-API-Key, X-Signature
       │    Body: { userId, amount, channel }
       │
       ▼
  ┌─────────────────────┐
  │   CloudFront CDN    │  ← 450+ Edge Locations (Global)
  │  (Edge Location)    │
  └──────────┬──────────┘
             │
             │ 2. WAF Rules Check
             │    ✓ Rate limit: 10K req/5min per IP
             │    ✓ SQL injection patterns
             │    ✓ Known bad inputs
             │
             ▼
  ┌─────────────────────┐
  │   AWS WAF           │  ← Block malicious requests
  └──────────┬──────────┘
             │
             │ 3. Route to nearest region
             │    (Route 53 latency-based routing)
             │
             ▼
  ┌─────────────────────┐
  │   Route 53 DNS      │  ← Health checks every 30s
  └──────────┬──────────┘
             │
             │ 4. Forward to ALB
             │    (HTTPS, TLS 1.2+)
             │
             ▼
  ┌─────────────────────────────────────────────────┐
  │         Application Load Balancer (ALB)         │
  │                                                 │
  │  ┌───────────────────────────────────────────┐ │
  │  │  1. SSL Termination (offload encryption)  │ │  ← 10 Gbps bandwidth
  │  │  2. HTTP/2 connection multiplexing        │ │     100K connections/AZ
  │  │  3. Connection pooling (5M → 5K)          │ │
  │  │  4. Health check (/health)                │ │
  │  │  5. Sticky session (cookie-based)         │ │
  │  │  6. Least outstanding requests routing    │ │
  │  └───────────────────────────────────────────┘ │
  └──────────────────────┬──────────────────────────┘
                         │
                         │ 5. Route to healthy ECS task
                         │    (based on least requests)
                         │
                         ▼
         ┌───────────────────────────────────────────────────┐
         │         ECS Fargate Task (1 of 1000)              │
         │                                                   │
         │  ┌─────────────────────────────────────────────┐ │
         │  │        Express.js Middleware Chain          │ │
         │  │                                             │ │
         │  │  1. Global IP Whitelist ✓                   │ │
         │  │  2. Helmet (Security headers) ✓             │ │
         │  │  3. Rate Limiter (Redis-based) ✓            │ │
         │  │     └─> Check Redis: ratelimit:IP          │ │  ← 1-5ms
         │  │         If > 50K/min → 429 Too Many Req    │ │
         │  │  4. CORS ✓                                  │ │
         │  │  5. Request Logger ✓                        │ │
         │  │                                             │ │
         │  └─────────────────┬───────────────────────────┘ │
         │                    │                             │
         │                    ▼                             │
         │  ┌─────────────────────────────────────────────┐ │
         │  │      /api/v1/payments Route Handler         │ │
         │  │                                             │ │
         │  │  1. API Key Authentication                  │ │
         │  │     └─> L1 Cache (in-memory): client:{key} │ │  ← 10μs (hit)
         │  │         └─> L2 Cache (Redis): client:{key} │ │  ← 1ms (hit)
         │  │             └─> MongoDB: PartnerClient      │ │  ← 50ms (miss)
         │  │                                             │ │
         │  │  2. Signature Verification (HMAC-SHA256)    │ │
         │  │     └─> Get secret from cache               │ │
         │  │         Validate signature                  │ │
         │  │                                             │ │
         │  │  3. Request Validation (express-validator)  │ │
         │  │     └─> userId, amount, channel required    │ │
         │  │                                             │ │
         │  └─────────────────┬───────────────────────────┘ │
         │                    │                             │
         │                    ▼                             │
         │  ┌─────────────────────────────────────────────┐ │
         │  │     Payment Creation Logic                  │ │
         │  │                                             │ │
         │  │  1. Idempotency Check (Redis Lock)          │ │
         │  │     └─> SETNX lock:order:{orderId} (60s)   │ │  ← 1ms
         │  │         If exists → Return existing order   │ │
         │  │                                             │ │
         │  │  2. Get Sub-Merchant (Cached)               │ │
         │  │     └─> L1 Cache → L2 Redis → MongoDB       │ │
         │  │         TTL: 60 minutes (rarely changes)    │ │
         │  │                                             │ │
         │  │  3. Calculate Fees                          │ │
         │  │     └─> baseAmount × (1 + feePercent)       │ │
         │  │         + feeFlat + weekendFee             │ │
         │  │                                             │ │
         │  │  4. Create Order in MongoDB                 │ │  ← 20ms write
         │  │     └─> Insert to Order collection          │ │     (primary)
         │  │         Auto-replicate to 2 secondaries     │ │
         │  │                                             │ │
         │  │  5. Call Payment Gateway (HiloGate/OY)      │ │
         │  │     └─> HTTP POST to 3rd party API         │ │  ← 100-300ms
         │  │         Exponential backoff (3 retries)     │ │     (external)
         │  │         Circuit breaker (50% error → open)  │ │
         │  │                                             │ │
         │  │  6. Update Order with Gateway Response      │ │  ← 20ms write
         │  │     └─> order.pgRefId = response.refId     │ │
         │  │         order.checkoutUrl = response.url    │ │
         │  │                                             │ │
         │  │  7. Queue Callback Job (Async)              │ │
         │  │     └─> Bull Queue: callback-delivery       │ │  ← 2ms
         │  │         Redis-backed, persistent            │ │     (async)
         │  │         Retry: 3 attempts, exponential      │ │
         │  │                                             │ │
         │  │  8. Cache Order (10 min TTL)                │ │
         │  │     └─> SET cache:order:{id} (600s)        │ │  ← 1ms
         │  │                                             │ │
         │  │  9. Return Response                         │ │
         │  │     └─> { orderId, checkoutUrl, qrCode }   │ │
         │  │                                             │ │
         │  └─────────────────┬───────────────────────────┘ │
         └────────────────────┼─────────────────────────────┘
                              │
                              │ 6. Response (HTTP 200)
                              │    Total time: 50-150ms (cached)
                              │                200-400ms (uncached)
                              │
                              ▼
         ┌────────────────────────────────────────┐
         │           ALB (Response)               │  ← Connection multiplexing
         │  • Compress response (gzip/brotli)     │     (reuse connections)
         │  • Add security headers                │
         │  • Log to CloudWatch                   │
         └────────────────────┬───────────────────┘
                              │
                              │ 7. Response via CloudFront
                              │
                              ▼
         ┌────────────────────────────────────────┐
         │         CloudFront (Edge)              │
         │  • Cache static responses (if enabled) │
         │  • Compress response (if not already)  │
         │  • Log to S3                           │
         └────────────────────┬───────────────────┘
                              │
                              │ 8. Return to client
                              │    (5-20ms from edge)
                              │
                              ▼
                         Client App


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              PARALLEL BACKGROUND JOBS                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Redis Bull Queue                           Worker Processes (ECS Tasks)
       │
       ├─> [Job: Callback Delivery]  ──────>  Worker 1 (3 concurrent)
       │   { orderId, partnerUrl }             └─> HTTP POST to partner webhook
       │   Priority: HIGH                          └─> Retry 3x on failure
       │   Delay: 0ms                              └─> Store in CallbackJob table
       │
       ├─> [Job: Status Check]  ──────────────>  Worker 2 (5 concurrent)
       │   { orderId, pgRefId }                   └─> Poll gateway status API
       │   Priority: NORMAL                        └─> Update order in MongoDB
       │   Delay: 30s                              └─> Queue if pending
       │
       └─> [Job: Settlement]  ────────────────>  Worker 3 (2 concurrent)
           { orderId }                             └─> Calculate final amounts
           Priority: LOW                           └─> Create settlement record
           Delay: 24h                              └─> Trigger disbursement


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                            MONITORING & OBSERVABILITY                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Every request generates:

   1. ALB Access Logs  ──────────────────────>  S3 Bucket (7 days retention)
      └─> Timestamp, IP, path, status, latency     └─> Athena for SQL queries

   2. Application Logs  ─────────────────────>  CloudWatch Logs
      └─> JSON structured logs                     └─> Log Insights queries
          { level, message, orderId, duration }    └─> Alarms on ERROR rate

   3. Custom Metrics  ───────────────────────>  CloudWatch Metrics
      └─> Payment success rate                     └─> Dashboards
      └─> Average transaction value                └─> Auto-scaling triggers
      └─> Cache hit rate                           └─> PagerDuty alerts

   4. Distributed Tracing (Optional)  ───────>  X-Ray
      └─> Request path visualization               └─> Bottleneck identification
      └─> Service map                              └─> Performance optimization


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              PERFORMANCE OPTIMIZATIONS                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Optimization Layer                 Impact                    Latency Reduction
   ──────────────────────────────────────────────────────────────────────────────────────

   1. L1 In-Memory Cache              Hit rate: 60%             1,000ms → 10ms
      (NodeCache, 10K keys)           TTL: 1-5 min              (99% faster)

   2. L2 Redis Cache                  Hit rate: 30%             1,000ms → 5ms
      (ElastiCache, 1M keys)          TTL: 5-60 min             (99.5% faster)

   3. Database Indexes                Query time: 90% faster    100ms → 10ms
      (Composite indexes)             (SELECT with WHERE)

   4. Connection Pooling              Reuse connections         50ms → 1ms
      (MongoDB: 500 pool)             (No handshake)            (connection overhead)

   5. HTTP/2 Multiplexing             Single TCP connection     20ms → 2ms
      (ALB → Client)                  (Multiple requests)       (SSL handshake)

   6. Async Processing                Non-blocking I/O          Immediate response
      (Bull Queues)                   (Background jobs)         (don't wait for callback)

   7. Circuit Breaker                 Fail fast on errors       5,000ms → 100ms
      (Opossum)                       (No retry storms)         (timeout avoidance)

   8. Response Compression            Bandwidth: 80% reduction  Transfer: 100ms → 20ms
      (Gzip/Brotli)                   (10KB → 2KB)              (smaller payload)

   ──────────────────────────────────────────────────────────────────────────────────────
   TOTAL LATENCY IMPROVEMENT:         p95: 2,700ms → 200ms     (13x faster)
```

---

## 3. Auto-Scaling Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         AUTO-SCALING DECISION FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   CloudWatch Metrics                        Auto-Scaling Policies                ECS Cluster
   (Every 1 minute)                          (Evaluation Period: 2 min)          (Current State)
        │                                                                              │
        │                                                                              │
        ├─> CPU Utilization: 45%                                                      │
        │   Memory Utilization: 60%                                                   │
        │   Request Count: 25,000/min              ┌─────────────────────┐           │
        │                                           │  All Metrics Normal │           │
        │   ──────────────────────────────────────> │  No Action Needed   │           │
        │                                           └─────────────────────┘           │
        │                                                                              │
        │                                                                        ┌─────▼─────┐
        │                                                                        │ 10 Tasks  │
        │                                                                        │ (Baseline)│
        │                                                                        └───────────┘
        │
        │  [15 minutes later: Traffic spike]
        │
        ├─> CPU Utilization: 75% ⚠️                ┌─────────────────────────────┐
        │   Memory Utilization: 82% ⚠️             │  Policy 1: CPU > 70%        │
        │   Request Count: 55,000/min ⚠️           │  for 2 consecutive minutes  │
        │                                           │                             │
        │   ──────────────────────────────────────> │  ✓ ALARM State              │
        │                                           │  Action: Scale OUT          │
        │                                           │  Increment: +10 tasks       │
        │                                           └───────────┬─────────────────┘
        │                                                       │
        │                                                       ▼
        │                                           ┌─────────────────────────────┐
        │                                           │  ECS Service Update         │
        │                                           │  Desired Count: 10 → 20     │
        │                                           └───────────┬─────────────────┘
        │                                                       │
        │                                                       ▼
        │                                                 ┌─────────────┐
        │                                                 │ Launch Tasks│
        │                                                 │  (60s each) │
        │                                                 └──────┬──────┘
        │                                                        │
        │                                                        ▼
        │                                           ┌──────────────────────────────┐
        │                                           │  ALB Slow Start (60s)        │
        │                                           │  0-15s:  25% traffic         │
        │                                           │  15-30s: 50% traffic         │
        │                                           │  30-45s: 75% traffic         │
        │                                           │  45-60s: 100% traffic        │
        │                                           └──────────┬───────────────────┘
        │                                                      │
        │                                                      ▼
        │                                                ┌─────────────┐
        │                                                │  20 Tasks   │
        │                                                │  (Active)   │
        │                                                └─────────────┘
        │
        │  [2 minutes later: Stabilized]
        │
        ├─> CPU Utilization: 38%                        ┌─────────────────────┐
        │   Memory Utilization: 45%                     │  Metrics Normal     │
        │   Request Count: 28,000/min                   │  Maintain 20 tasks  │
        │   ──────────────────────────────────────────> └─────────────────────┘
        │
        │
        │  [Extreme spike: Black Friday scenario]
        │
        ├─> CPU Utilization: 88% 🚨                     ┌──────────────────────────────┐
        │   Memory Utilization: 91% 🚨                  │  Policy 2: CPU > 85%         │
        │   Request Count: 150,000/min 🚨               │  OR Memory > 90%             │
        │   ALB Queue Depth: 15,000 🚨                  │  for 1 minute                │
        │                                               │                              │
        │   ─────────────────────────────────────────> │  ✓ CRITICAL ALARM            │
        │                                               │  Action: AGGRESSIVE Scale    │
        │                                               │  Increment: +50 tasks        │
        │                                               └───────────┬──────────────────┘
        │                                                           │
        │                                                           ▼
        │                                               ┌──────────────────────────────┐
        │                                               │  ECS Service Update          │
        │                                               │  Desired Count: 20 → 70      │
        │                                               └───────────┬──────────────────┘
        │                                                           │
        │                                                           ▼
        │                                                     ┌─────────────┐
        │                                                     │Launch 50    │
        │                                                     │Tasks (2 min)│
        │                                                     └──────┬──────┘
        │                                                            │
        │                                                            ▼
        │                                                      ┌─────────────┐
        │                                                      │  70 Tasks   │
        │                                                      │  (Active)   │
        │                                                      └─────────────┘
        │
        │  [Peak sustained: 5M concurrent requests]
        │
        ├─> CPU Utilization: 92% 🔥                          ┌─────────────────────────┐
        │   Memory Utilization: 94% 🔥                       │  Policy 3: Custom       │
        │   Request Count: 500,000/min 🔥                    │  Redis Queue > 50K      │
        │   Redis Queue Depth: 75,000 🔥                     │  for 1 minute           │
        │                                                    │                         │
        │   ──────────────────────────────────────────────> │  ✓ MAX SCALE ALARM      │
        │                                                    │  Action: Scale to MAX   │
        │                                                    │  Increment: +930 tasks  │
        │                                                    └───────────┬─────────────┘
        │                                                                │
        │                                                                ▼
        │                                                    ┌──────────────────────────┐
        │                                                    │  ECS Service Update      │
        │                                                    │  Desired: 70 → 1000      │
        │                                                    │  (Max capacity reached)  │
        │                                                    └───────────┬──────────────┘
        │                                                                │
        │                                                                ▼
        │                                                          ┌─────────────┐
        │                                                          │Launch 930   │
        │                                                          │Tasks (5 min)│
        │                                                          └──────┬──────┘
        │                                                                 │
        │                                                                 ▼
        │                                                           ┌─────────────┐
        │                                                           │ 1000 Tasks  │
        │                                                           │ (MAX)       │
        │                                                           └─────────────┘
        │
        │  [Traffic subsides: Night time]
        │
        ├─> CPU Utilization: 25%                               ┌──────────────────────┐
        │   Memory Utilization: 35%                            │  Policy 4: Scale IN  │
        │   Request Count: 5,000/min                           │  CPU < 30% for 10min │
        │                                                      │                      │
        │   ─────────────────────────────────────────────────> │  ✓ Scale Down        │
        │                                                      │  Decrement: -20 tasks│
        │                                                      │  (Gradual)           │
        │                                                      └──────────┬───────────┘
        │                                                                 │
        │                                                                 ▼
        │                                                     ┌────────────────────────┐
        │                                                     │  ECS Service Update    │
        │                                                     │  Desired: 1000 → 980   │
        │                                                     │  (Drain connections)   │
        │                                                     └──────────┬─────────────┘
        │                                                                │
        │                                                                ▼
        │                                                          ┌─────────────┐
        │                                                          │Terminate 20 │
        │                                                          │Tasks (5 min)│
        │                                                          └──────┬──────┘
        │                                                                 │
        │                                                                 ▼
        │                                                           ┌─────────────┐
        │                                                           │ 980 Tasks   │
        │                                                           │ (Scaling IN)│
        │                                                           └─────────────┘
        │
        │  [After 2 hours: Back to baseline]
        │
        ├─> CPU Utilization: 20%                              ┌──────────────────────┐
        │   Memory Utilization: 28%                           │  Continue Scale IN   │
        │   Request Count: 2,000/min                          │  until min (10 tasks)│
        │   ─────────────────────────────────────────────────>└──────────┬───────────┘
        │                                                                 │
        │                                                                 ▼
        │                                                           ┌─────────────┐
        │                                                           │  10 Tasks   │
        │                                                           │  (Baseline) │
        │                                                           └─────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         AUTO-SCALING POLICIES SUMMARY                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘

Policy Name              Trigger                      Action           Cooldown
─────────────────────────────────────────────────────────────────────────────────────────
Scale Out (Normal)       CPU > 70% for 2 min          +10 tasks        120s
Scale Out (High)         Memory > 80% for 2 min       +10 tasks        120s
Scale Out (Critical)     CPU > 85% for 1 min          +50 tasks        60s
Scale Out (Max)          Queue > 50K for 1 min        +100 tasks       30s
Scale Out (Request)      ALB > 50K req/min            +20 tasks        90s

Scale In (Normal)        CPU < 30% for 10 min         -20 tasks        300s
Scale In (Low)           CPU < 20% for 20 min         -50 tasks        600s

Protection               Always maintain              10 tasks (min)   N/A
                         Never exceed                 1000 tasks (max) N/A
```

---

## 4. Data Flow & Caching Strategy Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         MULTI-LAYER CACHING ARCHITECTURE                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Request: GET /api/v1/payments/{orderId}
        │
        ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                    LAYER 1: IN-MEMORY CACHE                     │
   │                    (NodeCache - Per Task)                       │
   │  ┌───────────────────────────────────────────────────────────┐ │
   │  │  Capacity: 10,000 keys per task                           │ │
   │  │  Memory: ~100 MB per task                                 │ │
   │  │  Latency: 10 microseconds                                 │ │
   │  │  TTL Strategy:                                            │ │
   │  │    • Hot data: 30 seconds                                 │ │
   │  │    • Warm data: 5 minutes                                 │ │
   │  │  Eviction: LRU (Least Recently Used)                      │ │
   │  │                                                           │ │
   │  │  Keys Stored:                                             │ │
   │  │    ✓ cache:order:{orderId}           (10s TTL)           │ │
   │  │    ✓ cache:client:{apiKey}           (5min TTL)          │ │
   │  │    ✓ cache:merchant:{id}             (5min TTL)          │ │
   │  └───────────────────────────────────────────────────────────┘ │
   └────────────────────────────┬────────────────────────────────────┘
                                │
                                │ MISS (40% of requests)
                                ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                    LAYER 2: REDIS CACHE                         │
   │                  (ElastiCache - Distributed)                    │
   │  ┌───────────────────────────────────────────────────────────┐ │
   │  │  Capacity: 158 GB (3 shards)                              │ │
   │  │  Throughput: 1.5M reads/sec, 500K writes/sec              │ │
   │  │  Latency: 1-5 milliseconds                                │ │
   │  │  TTL Strategy:                                            │ │
   │  │    • Static data: 24 hours (banks, payment methods)       │ │
   │  │    • Semi-static: 60 minutes (merchants, clients)         │ │
   │  │    • Dynamic: 5-10 minutes (orders, balances)             │ │
   │  │  Persistence: AOF (Append-Only File) every 1s             │ │
   │  │  Eviction: allkeys-lru (when memory full)                 │ │
   │  │                                                           │ │
   │  │  Data Structures:                                         │ │
   │  │    ┌─────────────────────────────────────────────────┐   │ │
   │  │    │  STRING:  cache:order:{id} → JSON               │   │ │
   │  │    │  STRING:  cache:client:{key} → JSON             │   │ │
   │  │    │  HASH:    ratelimit:{ip} → { count, expire }    │   │ │
   │  │    │  SET:     lock:order:{id} → timestamp           │   │ │
   │  │    │  ZSET:    queue:callback → [(score, jobId)]     │   │ │
   │  │    └─────────────────────────────────────────────────┘   │ │
   │  │                                                           │ │
   │  │  Cache Patterns:                                          │ │
   │  │    1. Cache-Aside (Read)                                  │ │
   │  │       └─> Try Redis → Miss → Fetch DB → Set Redis        │ │
   │  │    2. Write-Through (Write)                               │ │
   │  │       └─> Write DB → Invalidate/Update Redis             │ │
   │  │    3. Distributed Lock (Idempotency)                      │ │
   │  │       └─> SETNX lock:key → If OK, proceed                │ │
   │  └───────────────────────────────────────────────────────────┘ │
   └────────────────────────────┬────────────────────────────────────┘
                                │
                                │ MISS (10% of requests)
                                ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                    LAYER 3: DATABASE                            │
   │                  (MongoDB Replica Set)                          │
   │  ┌───────────────────────────────────────────────────────────┐ │
   │  │  Capacity: 6 TB (2TB per node × 3)                        │ │
   │  │  Throughput: 50K reads/sec, 10K writes/sec                │ │
   │  │  Latency: 20-100 milliseconds                             │ │
   │  │                                                           │ │
   │  │  Read Strategy: secondaryPreferred                        │ │
   │  │    ┌─────────────────────────────────────────────────┐   │ │
   │  │    │  67% → Secondary Nodes (AZ-B, AZ-C)             │   │ │
   │  │    │  33% → Primary Node (AZ-A, fallback)            │   │ │
   │  │    └─────────────────────────────────────────────────┘   │ │
   │  │                                                           │ │
   │  │  Write Strategy: primary (with majority write concern)    │ │
   │  │    └─> Write to Primary → Replicate to Secondaries       │ │
   │  │                                                           │ │
   │  │  Indexes (Critical for Performance):                      │ │
   │  │    ✓ Order: [partnerClientId, status, createdAt]         │ │
   │  │    ✓ Order: [pgRefId] (unique lookup)                    │ │
   │  │    ✓ PartnerClient: [apiKey] (unique)                    │ │
   │  │    ✓ CallbackJob: [delivered, createdAt]                 │ │
   │  │                                                           │ │
   │  │  Connection Pool:                                         │ │
   │  │    └─> maxPoolSize: 500 (per ECS task)                   │ │
   │  │        minPoolSize: 50 (warm connections)                │ │
   │  │        Total: 500 × 1000 tasks = 500K possible conns     │ │
   │  │        (MongoDB supports 10K max per node)               │ │
   │  └───────────────────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         CACHE INVALIDATION STRATEGY                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Event                              Invalidation Action                   Impact
   ──────────────────────────────────────────────────────────────────────────────────────
   1. Order Created                   ✗ No cache (new data)                 N/A

   2. Order Status Updated            ✓ DEL cache:order:{id}                Immediate
      (Payment Success)               ✓ Update L1 cache (if exists)
                                      └─> Next request: Cache miss → Fresh DB read

   3. Client API Key Rotated          ✓ DEL cache:client:{oldKey}           <1s
                                      └─> All tasks refresh in ~10s (L1 TTL)

   4. Merchant Fee Changed            ✓ DEL cache:merchant:{id}             <5min
                                      └─> Next transaction: Fresh fee calc

   5. Callback Delivered              ✓ DEL cache:order:{id}                Immediate
                                      └─> Update order.callbackStatus

   6. Manual Cache Clear (Admin)      ✓ FLUSHDB pattern:*                   <1min
      Example: DEL cache:client:*     └─> All clients refreshed

   7. Database Failover               ✓ Keep cache (stale is OK)            0s
      (MongoDB Primary Down)          └─> Serve from cache until recovery


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         CACHE HIT RATE OPTIMIZATION                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Scenario: 1M Requests/Hour (Payment Creation)

   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  WITHOUT CACHE (Baseline)                                                   │
   │  • All requests → MongoDB                                                   │
   │  • Latency: 50-100ms per request                                            │
   │  • MongoDB Load: 1M queries/hour = 278 queries/sec                          │
   │  • Cost: High CPU usage, potential bottleneck                               │
   └─────────────────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  WITH L2 CACHE (Redis Only)                                                 │
   │  • 70% Hit Rate → 700K from Redis (1-5ms)                                   │
   │  • 30% Miss → 300K from MongoDB (50ms)                                      │
   │  • MongoDB Load: 300K/hour = 83 queries/sec (70% reduction)                 │
   │  • Avg Latency: (700K × 5ms + 300K × 50ms) / 1M = 18.5ms                    │
   └─────────────────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  WITH L1 + L2 CACHE (Optimal)                                               │
   │  • 60% L1 Hit → 600K from memory (0.01ms)                                   │
   │  • 30% L2 Hit → 300K from Redis (5ms)                                       │
   │  • 10% Miss → 100K from MongoDB (50ms)                                      │
   │  • MongoDB Load: 100K/hour = 28 queries/sec (90% reduction!)                │
   │  • Avg Latency: (600K × 0.01ms + 300K × 5ms + 100K × 50ms) / 1M = 6.5ms     │
   │                                                                             │
   │  Result: 13x faster response time, 90% less DB load!                        │
   └─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         DISTRIBUTED LOCK PATTERN (Idempotency)                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Request: POST /api/v1/payments/create
   Body: { userId: "user123", amount: 100000, channel: "qris" }

   Step 1: Generate Order ID (deterministic)
   ────────────────────────────────────────────────────────────────────────────
   orderId = hash(userId + amount + timestamp.floor(1min))
   Example: "ORD-user123-100000-202410061430"

   Step 2: Try to Acquire Lock (SETNX)
   ────────────────────────────────────────────────────────────────────────────
   Redis Command:
   SET lock:order:ORD-user123-100000-202410061430 "timestamp" EX 120 NX

   Response: OK (lock acquired) → Proceed to create order
             (nil) (lock exists) → Return existing order from cache/DB

   Step 3: Process Payment
   ────────────────────────────────────────────────────────────────────────────
   If lock acquired:
     1. Create order in MongoDB
     2. Call payment gateway
     3. Store order in Redis cache (10 min TTL)
     4. Release lock (DEL lock:order:...)
     5. Return response

   If lock exists (duplicate request):
     1. GET cache:order:ORD-... (likely in cache)
     2. If cache miss → GET from MongoDB
     3. Return existing order (idempotent!)

   Benefits:
   ────────────────────────────────────────────────────────────────────────────
   • Prevents duplicate orders (user clicks "Pay" twice)
   • Distributed across all ECS tasks (Redis is shared)
   • Automatic expiration (120s TTL)
   • No database locks needed (MongoDB is free)
```

---

## 5. Security Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         DEFENSE IN DEPTH SECURITY LAYERS                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Layer 1: PERIMETER (Internet Edge)
   ═══════════════════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         AWS Shield Standard (DDoS)                               │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  • Automatic detection and mitigation                                     │  │
   │  │  • Protects against SYN/UDP floods                                        │  │
   │  │  │  • Layer 3/4 attacks blocked at edge                                   │  │
   │  │  • No additional cost (included)                                          │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ Clean traffic only
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         AWS WAF (Web Application Firewall)                       │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  Rule 1: Rate Limiting                                                    │  │
   │  │    └─> 10,000 requests per 5 minutes per IP                               │  │
   │  │        Action: Block for 1 hour                                           │  │
   │  │                                                                           │  │
   │  │  Rule 2: Geo-Blocking (Optional)                                          │  │
   │  │    └─> Allow: ID, SG, MY, TH, PH, VN                                      │  │
   │  │        Block: All other countries                                         │  │
   │  │                                                                           │  │
   │  │  Rule 3: SQL Injection Protection                                         │  │
   │  │    └─> AWSManagedRulesSQLiRuleSet                                         │  │
   │  │        Blocks: ' OR 1=1--, UNION SELECT, etc.                             │  │
   │  │                                                                           │  │
   │  │  Rule 4: XSS Protection                                                   │  │
   │  │    └─> AWSManagedRulesCommonRuleSet                                       │  │
   │  │        Blocks: <script>, eval(), etc.                                     │  │
   │  │                                                                           │  │
   │  │  Rule 5: Known Bad Inputs                                                 │  │
   │  │    └─> AWSManagedRulesKnownBadInputsRuleSet                               │  │
   │  │        Blocks: Path traversal (../../), command injection                 │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ Validated traffic
                                        ▼

   Layer 2: NETWORK (VPC & Security Groups)
   ═══════════════════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         VPC Flow Logs (Audit Trail)                              │
   │  └─> All network traffic logged to S3 (30 days retention)                       │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         Security Group: ALB                                      │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  INBOUND:                                                                 │  │
   │  │    ✓ Port 443 (HTTPS) from 0.0.0.0/0                                      │  │
   │  │    ✓ Port 80 (HTTP) from 0.0.0.0/0 → Redirect to 443                      │  │
   │  │    ✗ All other ports DENIED                                               │  │
   │  │                                                                           │  │
   │  │  OUTBOUND:                                                                │  │
   │  │    ✓ Port 3000 to SG-ECS only                                             │  │
   │  │    ✗ All other destinations DENIED                                        │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         Security Group: ECS Tasks                                │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  INBOUND:                                                                 │  │
   │  │    ✓ Port 3000 from SG-ALB only                                           │  │
   │  │    ✗ Direct Internet access DENIED                                        │  │
   │  │                                                                           │  │
   │  │  OUTBOUND:                                                                │  │
   │  │    ✓ Port 6379 to SG-Redis only                                           │  │
   │  │    ✓ Port 27017 to SG-MongoDB only                                        │  │
   │  │    ✓ Port 443 to 0.0.0.0/0 (3rd party APIs: HiloGate, OY)                 │  │
   │  │    ✗ All other ports DENIED                                               │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │                               │
                        ▼                               ▼
   ┌─────────────────────────────────┐   ┌─────────────────────────────────────────┐
   │  Security Group: Redis          │   │  Security Group: MongoDB                │
   │  ┌───────────────────────────┐  │   │  ┌───────────────────────────────────┐  │
   │  │  INBOUND:                 │  │   │  │  INBOUND:                         │  │
   │  │    ✓ 6379 from SG-ECS     │  │   │  │    ✓ 27017 from SG-ECS            │  │
   │  │    ✗ Internet DENIED      │  │   │  │    ✓ 27017 from SG-MongoDB        │  │
   │  │                           │  │   │  │      (replica sync)               │  │
   │  │  OUTBOUND:                │  │   │  │    ✗ Internet DENIED              │  │
   │  │    ✗ All DENIED           │  │   │  │                                   │  │
   │  │      (No egress needed)   │  │   │  │  OUTBOUND:                        │  │
   │  └───────────────────────────┘  │   │  │    ✓ 27017 to SG-MongoDB          │  │
   └─────────────────────────────────┘   │  │      (replica sync)               │  │
                                         │  │    ✓ 443 to 0.0.0.0/0             │  │
                                         │  │      (OS updates only)            │  │
                                         │  └───────────────────────────────────┘  │
                                         └─────────────────────────────────────────┘

   Layer 3: APPLICATION (Code-Level Security)
   ═══════════════════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         API Security Middleware                                  │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  1. Helmet.js (HTTP Headers)                                              │  │
   │  │     └─> X-Frame-Options: DENY                                             │  │
   │  │         X-Content-Type-Options: nosniff                                   │  │
   │  │         Strict-Transport-Security: max-age=31536000                       │  │
   │  │                                                                           │  │
   │  │  2. API Key Authentication                                                │  │
   │  │     └─> Validate X-API-Key header                                         │  │
   │  │         Lookup in PartnerClient table (cached)                            │  │
   │  │         Check isActive = true                                             │  │
   │  │                                                                           │  │
   │  │  3. HMAC Signature Verification                                           │  │
   │  │     └─> X-Signature header                                                │  │
   │  │         Algorithm: HMAC-SHA256                                            │  │
   │  │         Secret: From Secrets Manager                                      │  │
   │  │         Payload: JSON.stringify(body) + timestamp                         │  │
   │  │         Tolerance: ±5 minutes (prevent replay attacks)                    │  │
   │  │                                                                           │  │
   │  │  4. Input Validation (express-validator)                                  │  │
   │  │     └─> Sanitize: XSS, SQL injection                                      │  │
   │  │         Type check: Numbers, strings, enums                               │  │
   │  │         Length limits: max 255 chars                                      │  │
   │  │                                                                           │  │
   │  │  5. Rate Limiting (Redis-based)                                           │  │
   │  │     └─> Key: ratelimit:{apiKey}:{IP}                                      │  │
   │  │         Limit: 50,000 requests/minute                                     │  │
   │  │         Response: 429 Too Many Requests                                   │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘

   Layer 4: DATA (Encryption)
   ═══════════════════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         Encryption at Rest                                       │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  • EBS Volumes (MongoDB): AWS KMS encryption (AES-256)                    │  │
   │  │  • ElastiCache Redis: At-rest encryption enabled                          │  │
   │  │  • S3 Buckets: SSE-S3 (AES-256)                                           │  │
   │  │  • Secrets Manager: KMS encryption                                        │  │
   │  │  • RDS Snapshots: Encrypted (if used)                                     │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         Encryption in Transit                                    │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │  • Client → CloudFront: TLS 1.2+ (ACM Certificate)                        │  │
   │  │  • CloudFront → ALB: TLS 1.2+                                             │  │
   │  │  • ALB → ECS: HTTP (within VPC, optional TLS)                             │  │
   │  │  • ECS → Redis: TLS 1.2 (ElastiCache in-transit encryption)               │  │
   │  │  • ECS → MongoDB: TLS 1.2 (optional, recommended)                         │  │
   │  │  • ECS → 3rd Party: HTTPS (TLS 1.2+)                                      │  │
   │  └───────────────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────────────┘

   Layer 5: AUDIT & COMPLIANCE
   ═══════════════════════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         CloudTrail (API Audit Logs)                              │
   │  └─> All AWS API calls logged (who, what, when, where)                          │
   │      Retention: 90 days in CloudWatch, permanent in S3                          │
   └─────────────────────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         GuardDuty (Threat Detection)                             │
   │  └─> Machine learning-based threat detection                                    │
   │      Alerts: Unauthorized access, crypto mining, port scanning                  │
   └─────────────────────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         Config (Compliance Monitoring)                           │
   │  └─> Track configuration changes                                                │
   │      Rules: Ensure encryption enabled, public access blocked                    │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. MongoDB Cluster Topology (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    MONGODB REPLICA SET: "launcx-rs" (Self-Hosted)                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Availability Zone A               Availability Zone B               Availability Zone C
   (ap-southeast-1a)                 (ap-southeast-1b)                 (ap-southeast-1c)
   ─────────────────────────         ─────────────────────────         ─────────────────────────

   ┌─────────────────────────┐       ┌─────────────────────────┐       ┌─────────────────────────┐
   │  PRIMARY NODE           │       │  SECONDARY NODE 1       │       │  SECONDARY NODE 2       │
   │                         │       │                         │       │                         │
   │  ┌───────────────────┐  │       │  ┌───────────────────┐  │       │  ┌───────────────────┐  │
   │  │  EC2 Instance     │  │       │  │  EC2 Instance     │  │       │  │  EC2 Instance     │  │
   │  │  r6g.2xlarge      │  │       │  │  r6g.2xlarge      │  │       │  │  r6g.2xlarge      │  │
   │  │  (ARM Graviton2)  │  │       │  │  (ARM Graviton2)  │  │       │  │  (ARM Graviton2)  │  │
   │  ├───────────────────┤  │       │  ├───────────────────┤  │       │  ├───────────────────┤  │
   │  │  8 vCPU           │  │       │  │  8 vCPU           │  │       │  │  8 vCPU           │  │
   │  │  64 GB RAM        │  │       │  │  64 GB RAM        │  │       │  │  64 GB RAM        │  │
   │  │  48 GB WiredTiger │  │       │  │  48 GB WiredTiger │  │       │  │  48 GB WiredTiger │  │
   │  │  Cache (75%)      │  │       │  │  Cache (75%)      │  │       │  │  Cache (75%)      │  │
   │  └───────────────────┘  │       │  └───────────────────┘  │       │  └───────────────────┘  │
   │                         │       │                         │       │                         │
   │  ┌───────────────────┐  │       │  ┌───────────────────┐  │       │  ┌───────────────────┐  │
   │  │  EBS gp3 Volume   │  │       │  │  EBS gp3 Volume   │  │       │  │  EBS gp3 Volume   │  │
   │  │  2 TB             │  │       │  │  2 TB             │  │       │  │  2 TB             │  │
   │  │  16,000 IOPS      │  │       │  │  16,000 IOPS      │  │       │  │  16,000 IOPS      │  │
   │  │  1,000 MB/s       │  │       │  │  1,000 MB/s       │  │       │  │  1,000 MB/s       │  │
   │  └───────────────────┘  │       │  └───────────────────┘  │       │  └───────────────────┘  │
   │                         │       │                         │       │                         │
   │  IP: 10.0.20.10:27017   │       │  IP: 10.0.21.10:27017   │       │  IP: 10.0.22.10:27017   │
   │  Priority: 2 (prefer)   │       │  Priority: 1            │       │  Priority: 1            │
   │  Votes: 1               │       │  Votes: 1               │       │  Votes: 1               │
   └─────────────────────────┘       └─────────────────────────┘       └─────────────────────────┘
              │                                   │                                   │
              │                                   │                                   │
              │◄──────────────────────────────────┼──────────────────────────────────►│
              │         OPLOG REPLICATION         │         OPLOG REPLICATION         │
              │         (Async, ~100ms lag)       │         (Async, ~100ms lag)       │
              │                                   │                                   │
              └───────────────────┬───────────────┴───────────────────────────────────┘
                                  │
                                  │ Heartbeat (2s interval)
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         ARBITER NODE (Quorum Only)                               │
   │                         Availability Zone A (ap-southeast-1a)                    │
   │  ┌────────────────────────────────────────────────────────────────────────────┐ │
   │  │  EC2 Instance: t4g.small (2 vCPU, 2 GB RAM)                                │ │
   │  │  Storage: 20 GB gp3                                                        │ │
   │  │  IP: 10.0.20.11:27017                                                      │ │
   │  │  Priority: 0 (cannot become primary)                                       │ │
   │  │  Votes: 1                                                                  │ │
   │  │                                                                            │ │
   │  │  Purpose: Break ties in elections (total 4 votes = majority possible)     │ │
   │  └────────────────────────────────────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         WRITE OPERATIONS (PRIMARY ONLY)                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   ECS Task                                      MongoDB Cluster
        │                                              │
        │ 1. INSERT Order                              │
        │    db.Order.insertOne({...})                 │
        │                                              │
        ├──────────────────────────────────────────────►  PRIMARY (AZ-A)
        │                                              │  └─> Write to WiredTiger
        │                                              │      └─> Write to Journal (fsync)
        │                                              │          └─> Write to Oplog
        │                                              │              (capped collection)
        │                                              │
        │                                              │  Replication (async):
        │                                              │  ┌─> SECONDARY 1 (AZ-B)
        │                                              │  │   └─> Read oplog from Primary
        │                                              │  │       └─> Apply operations
        │                                              │  │           (100ms lag typical)
        │                                              │  │
        │                                              │  └─> SECONDARY 2 (AZ-C)
        │                                              │      └─> Read oplog from Primary
        │                                              │          └─> Apply operations
        │                                              │              (100ms lag typical)
        │                                              │
        │ 2. Acknowledge (writeConcern: majority)      │
        │    (Wait for 2/3 nodes)                      │
        │                                              │
        │◄─────────────────────────────────────────────┤
        │ { acknowledged: true, insertedId: ... }      │


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         READ OPERATIONS (LOAD BALANCED)                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   ECS Task                                      MongoDB Cluster
        │                                              │
        │ Query: db.Order.find({ status: "PENDING" }) │
        │ Read Preference: secondaryPreferred          │
        │                                              │
        │                                              ▼
        │                                         MongoDB Driver
        │                                         (Load Balancer)
        │                                              │
        │                                              ├─> 67% to Secondaries
        │                                              │   (Lower latency, higher capacity)
        │                                              │
        │                                              ├─────────────────┐
        │                                              │                 │
        │                                              ▼                 ▼
        │                                    SECONDARY 1 (AZ-B)   SECONDARY 2 (AZ-C)
        │                                    │                    │
        │◄───────────────────────────────────┤                    │
        │ { orders: [...] }                  │                    │
        │ (40ms latency)                     │                    │
        │                                                         │
        │                                    If Secondaries down: │
        │                                         Fallback        │
        │                                              │          │
        │                                              ▼          │
        │                                    PRIMARY (AZ-A)       │
        │                                    (33% baseline)       │
        │◄───────────────────────────────────┤                    │
        │ { orders: [...] }                                       │
        │ (50ms latency)                                          │


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         AUTOMATIC FAILOVER (Primary Failure)                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Time: T+0s
   ──────────────────────────────────────────────────────────────────────────────────────
   PRIMARY (AZ-A) goes down (EC2 failure, network partition, etc.)

   Time: T+2s
   ──────────────────────────────────────────────────────────────────────────────────────
   Heartbeat fails (2s interval)
   SECONDARY 1 detects: "Primary is unreachable"
   SECONDARY 2 detects: "Primary is unreachable"

   Time: T+10s (default election timeout)
   ──────────────────────────────────────────────────────────────────────────────────────
   ELECTION TRIGGERED

   SECONDARY 1 (AZ-B):
     └─> "I'm ready to be primary"
         Priority: 1, Votes: 1
         Requests vote from SECONDARY 2 and ARBITER

   SECONDARY 2 (AZ-C):
     └─> "I vote for SECONDARY 1"
         Priority: 1, Votes: 1

   ARBITER (AZ-A):
     └─> "I vote for SECONDARY 1"
         (Breaks tie if needed)

   Votes: 3/4 (majority = 3)

   Time: T+12s
   ──────────────────────────────────────────────────────────────────────────────────────
   SECONDARY 1 (AZ-B) becomes PRIMARY

   Replica Set State:
     PRIMARY: 10.0.21.10:27017 (was Secondary 1)
     SECONDARY: 10.0.22.10:27017 (Secondary 2, unchanged)
     DOWN: 10.0.20.10:27017 (old Primary)
     ARBITER: 10.0.20.11:27017 (unchanged)

   Time: T+15s
   ──────────────────────────────────────────────────────────────────────────────────────
   MongoDB driver detects new primary (via heartbeat)
   All WRITE operations now go to 10.0.21.10:27017

   Application impact:
     └─> 10-15 seconds of write errors (can retry)
     └─> READ operations unaffected (still have 1 secondary)

   Time: T+30min (old primary recovered)
   ──────────────────────────────────────────────────────────────────────────────────────
   Old PRIMARY (AZ-A) comes back online
   Joins as SECONDARY (priority 2, but current primary is stable)
   Catches up via oplog replay
   Replica set now has 2 secondaries again

   Final State (Manual failback optional):
     PRIMARY: 10.0.21.10:27017 (AZ-B)
     SECONDARY: 10.0.22.10:27017 (AZ-C)
     SECONDARY: 10.0.20.10:27017 (AZ-A, recovered)
     ARBITER: 10.0.20.11:27017


┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         BACKUP & RESTORE FLOW                                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘

   Daily Backup (02:00 UTC)
   ──────────────────────────────────────────────────────────────────────────────────────

   ┌─────────────────────────┐
   │  Backup Script          │  (Runs on PRIMARY node)
   │  (Cron job)             │
   └────────────┬────────────┘
                │
                │ 1. mongodump --oplog
                │    (Includes point-in-time oplog)
                ▼
   ┌─────────────────────────────────────┐
   │  Local Backup Directory             │
   │  /backup/daily-20241006/            │
   │  ├── Order.bson.gz                  │
   │  ├── PartnerClient.bson.gz          │
   │  ├── CallbackJob.bson.gz            │
   │  ├── oplog.bson.gz (100GB)          │
   │  └── metadata.json                  │
   └────────────┬────────────────────────┘
                │
                │ 2. aws s3 sync (gzip compressed)
                ▼
   ┌─────────────────────────────────────┐
   │  S3 Bucket                          │
   │  s3://launcx-mongodb-backups/       │
   │  └── daily/                         │
   │      └── 20241006/                  │
   │          ├── Order.bson.gz          │
   │          ├── ...                    │
   │          └── oplog.bson.gz          │
   └─────────────────────────────────────┘

   Weekly Snapshot (Sunday 03:00 UTC)
   ──────────────────────────────────────────────────────────────────────────────────────

   ┌─────────────────────────┐
   │  AWS Lambda             │  (EventBridge trigger)
   └────────────┬────────────┘
                │
                │ 1. Create EBS snapshots
                │    (All 3 nodes simultaneously)
                ▼
   ┌─────────────────────────────────────────────────────┐
   │  EBS Snapshots                                      │
   │  ├── snap-primary-20241006   (2TB, incremental)    │
   │  ├── snap-secondary1-20241006 (2TB, incremental)   │
   │  └── snap-secondary2-20241006 (2TB, incremental)   │
   └─────────────────────────────────────────────────────┘

   Restore Procedure (Disaster Recovery)
   ──────────────────────────────────────────────────────────────────────────────────────

   1. Stop application (prevent writes)
      └─> aws ecs update-service --desired-count 0

   2. Download backup from S3
      └─> aws s3 sync s3://launcx-mongodb-backups/daily/20241006/ /restore/

   3. Restore to MongoDB
      └─> mongorestore --oplogReplay --dir=/restore/

   4. Verify data integrity
      └─> db.Order.countDocuments()

   5. Start application
      └─> aws ecs update-service --desired-count 10

   Recovery Time: ~30 minutes (for 2TB database)
   Recovery Point: Last backup (max 24 hours data loss)
```

---

**Document Version**: 2.0
**Last Updated**: October 6, 2024
**Purpose**: Visual topology and architecture diagrams for 5M concurrent scale strategy
