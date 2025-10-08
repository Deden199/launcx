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
  const gotKey = req.header('X-API-Key')
  const ts     = req.header('X-Timestamp')
  if (!gotKey || !ts)
    return res.status(401).json({ error: 'Missing API key or timestamp' })

  const timestamp = parseInt(ts, 10)
  const SKEW = 5 * 60 * 1000
  if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > SKEW)
    return res.status(400).json({ error: 'Invalid or expired timestamp' })

  // Try to get from cache first (5 min TTL)
  const cacheKey = `apikey:${gotKey}`
  let clientData = await RedisCache.get<CachedClientData>(cacheKey)

  if (!clientData) {
    // 1) Cari partnerClient + parentClientId from DB
    const client = await prisma.partnerClient.findUnique({
      where: { apiKey: gotKey },
      select: { id: true, apiKey: true, isActive: true, parentClientId: true }
    })

    if (!client || !client.isActive)
      return res.status(401).json({ error: 'Invalid or inactive API key' })

    // 2) Load children
    const kids = await prisma.partnerClient.findMany({
      where: { parentClientId: client.id },
      select: { id: true }
    })

    // 3) Cache the result
    clientData = {
      id: client.id,
      apiKey: client.apiKey,
      isActive: client.isActive,
      parentClientId: client.parentClientId,
      childrenIds: kids.map(c => c.id)
    }
    await RedisCache.set(cacheKey, clientData, 300) // 5 min cache
  }

  // Validate active status
  if (!clientData.isActive)
    return res.status(401).json({ error: 'Invalid or inactive API key' })

  // 4) Compare timing-safe
  if (!crypto.timingSafeEqual(Buffer.from(clientData.apiKey), Buffer.from(gotKey)))
    return res.status(401).json({ error: 'Invalid API key' })

  // 5) Attach context
  req.clientId = clientData.id
  req.isParent = clientData.childrenIds.length > 0
  if (req.isParent) {
    req.childrenIds = clientData.childrenIds
  }

  next()
}
