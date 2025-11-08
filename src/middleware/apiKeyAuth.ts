import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../core/prisma'
import { RedisCache } from '../config/redis'

export interface ApiKeyRequest extends Request {
  clientId?: string
  isParent?: boolean
  childrenIds?: string[]
}

interface CachedClientData {
  id: string
  apiKey: string
  isActive: boolean
  parentClientId: string | null
  childrenIds: string[]
}

export default async function apiKeyAuth(
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
) {
  const gotKey = req.header('X-API-Key')?.trim()
  const ts     = req.header('X-Timestamp')?.trim()
  console.log('API Key Auth - X-API-Key:', gotKey, 'X-Timestamp:', ts)

  if (!gotKey || !ts) {
    return res.status(401).json({ error: 'Missing API key or timestamp' })
  }

  // --- parse timestamp safely ---
  const timestamp = Number(ts)
  if (!Number.isInteger(timestamp)) {
    return res.status(400).json({ error: 'Invalid timestamp format' })
  }

  const SKEW = 5 * 60 * 1000 // 5 minutes in ms
  const timeDiff = Math.abs(Date.now() - timestamp)
  console.log(`[Auth] timeDiff=${timeDiff}, SKEW=${SKEW}`)

  if (timeDiff > SKEW) {
    return res.status(400).json({ error: 'Expired timestamp' })
  }

  // --- Try to get client data from Redis cache first ---
  const cacheKey = `apikey:${gotKey}`
  let clientData = await RedisCache.get<CachedClientData>(cacheKey)
  console.log(`[Auth] Cache hit: ${!!clientData}`)

  if (!clientData) {
    // 1) Cari partnerClient + parentClientId dari DB
    const client = await prisma.partnerClient.findUnique({
      where: { apiKey: gotKey },
      select: { id: true, apiKey: true, isActive: true, parentClientId: true }
    })
    console.log(`[Auth] DB lookup: client=${client?.id}, isActive=${client?.isActive}`)

    if (!client || !client.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive API key' })
    }

    // 2) Load children
    const kids = await prisma.partnerClient.findMany({
      where: { parentClientId: client.id },
      select: { id: true }
    })

    // 3) Cache the result (TTL 5 menit)
    clientData = {
      id: client.id,
      apiKey: client.apiKey,
      isActive: client.isActive,
      parentClientId: client.parentClientId,
      childrenIds: kids.map(c => c.id)
    }
    await RedisCache.set(cacheKey, clientData, 300)
  }

  // --- Validate active status ---
  if (!clientData.isActive) {
    return res.status(401).json({ error: 'Invalid or inactive API key' })
  }

  // --- Timing-safe comparison ---
  if (!crypto.timingSafeEqual(Buffer.from(clientData.apiKey), Buffer.from(gotKey))) {
    return res.status(401).json({ error: 'Invalid API key' })
  }

  // --- Attach context for downstream handlers ---
  req.clientId = clientData.id
  req.isParent = clientData.childrenIds.length > 0
  if (req.isParent) {
    req.childrenIds = clientData.childrenIds
  }

  console.log(`[Auth] ✓ Success: clientId=${req.clientId}, method=${req.method}, path=${req.path}`)
  next()
}