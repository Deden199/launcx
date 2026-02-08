export type ProviderKey = 'hilogate' | 'oy' | 'gidi' | 'ifp' | 'ing1' | 'piro' | 'genesis'

export type GatewayMapping = {
  gatewayId: string
  label: string
  providerKey: ProviderKey
}

const PROVIDER_GATEWAY_LIST: GatewayMapping[] = [
  { providerKey: 'hilogate', gatewayId: 'G1', label: 'Gateway G1 (Primary)' },
  { providerKey: 'oy', gatewayId: 'G2', label: 'Gateway G2 (VA Aggregator)' },
  { providerKey: 'gidi', gatewayId: 'G3', label: 'Gateway G3 (Disbursement)' },
  { providerKey: 'ifp', gatewayId: 'G4', label: 'Gateway G4 (Alt)' },
  { providerKey: 'ing1', gatewayId: 'G5', label: 'Gateway G5 (Billers)' },
  { providerKey: 'piro', gatewayId: 'G6', label: 'Gateway G6 (Retail)' },
  { providerKey: 'genesis', gatewayId: 'G7', label: 'Gateway G7 (Retail 2)' },
]

const PROVIDER_TO_GATEWAY = new Map(PROVIDER_GATEWAY_LIST.map(item => [item.providerKey, item]))
const GATEWAY_TO_PROVIDER = new Map(PROVIDER_GATEWAY_LIST.map(item => [item.gatewayId.toLowerCase(), item.providerKey]))

export function listGatewayMappings() {
  return [...PROVIDER_GATEWAY_LIST]
}

export function providerKeyToGatewayId(providerKey?: string | null) {
  if (!providerKey) return ''
  return PROVIDER_TO_GATEWAY.get(providerKey as ProviderKey)?.gatewayId ?? 'G?'
}

export function providerKeyToGatewayLabel(providerKey?: string | null) {
  if (!providerKey) return 'Gateway (Unknown)'
  return PROVIDER_TO_GATEWAY.get(providerKey as ProviderKey)?.label ?? 'Gateway (Unknown)'
}

export function providerToGateway(providerKey?: string | null) {
  if (!providerKey) return { gatewayId: 'G?', label: 'Gateway (Unknown)' }
  const match = PROVIDER_TO_GATEWAY.get(providerKey as ProviderKey)
  return match ? { gatewayId: match.gatewayId, label: match.label } : { gatewayId: 'G?', label: 'Gateway (Unknown)' }
}

export function gatewayIdToProviderKey(gatewayId?: string | null) {
  if (!gatewayId) return ''
  return GATEWAY_TO_PROVIDER.get(String(gatewayId).toLowerCase()) ?? ''
}

export function normalizeProviderKey(input?: string | null) {
  if (!input) return ''
  const trimmed = String(input).trim()
  return gatewayIdToProviderKey(trimmed) || trimmed.toLowerCase()
}

export function gatewayToProvider(gatewayId?: string | null) {
  if (!gatewayId) return ''
  return gatewayIdToProviderKey(gatewayId) || String(gatewayId).trim().toLowerCase()
}

export function sanitizeProviderText(input?: string | null) {
  if (!input) return input
  let output = input
  for (const item of PROVIDER_GATEWAY_LIST) {
    const pattern = new RegExp(`\\b${item.providerKey}\\b`, 'gi')
    output = output.replace(pattern, item.gatewayId)
  }
  return output
}

export function sanitizeLogField(value?: string | null) {
  if (!value) return value
  return sanitizeProviderText(value)
}

export function sanitizeLogUrl(value?: string | null) {
  if (!value) return value
  try {
    const url = new URL(value)
    const masked = new URL(url.toString())
    masked.hostname = '[MASKED]'
    return masked.toString()
  } catch {
    return '[MASKED]'
  }
}
