import { unsealJson, type SealedBlob } from '../shared/seal'
import sealed from './generated/sealed-secret.json'

export interface ServiceConfig {
  apiKey: string
  model: string
  endpoint: string
}

let cache: ServiceConfig | null = null

export function getServiceConfig(): ServiceConfig {
  if (cache) return cache
  try {
    const value = unsealJson(sealed as SealedBlob) as Partial<ServiceConfig>
    cache = {
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
      model: typeof value.model === 'string' ? value.model : '',
      endpoint: typeof value.endpoint === 'string' ? value.endpoint : ''
    }
  } catch {
    cache = { apiKey: '', model: '', endpoint: '' }
  }
  return cache
}
