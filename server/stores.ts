import dns from 'node:dns/promises'
import net from 'node:net'

export type StoreStatus = 'viavel' | 'parcial' | 'indisponivel' | 'pendente'
export type AdapterKind = 'jsonld' | 'vtex' | 'amazon' | null

export interface StoreDef {
  key: string
  label: string
  domains: string[] // domínio raiz; subdomínios aceitos
  adapter: AdapterKind
  status: StoreStatus
  note: string
}

/**
 * Registro das 8 lojas candidatas. O status vem da prova de coleta (docs/prova-de-coleta.md).
 * Loja sem adaptador viável continua listada e aceita ofertas com preço manual.
 */
export const STORES: StoreDef[] = [
  {
    key: 'leroymerlin',
    label: 'Leroy Merlin',
    domains: ['leroymerlin.com.br'],
    adapter: 'jsonld',
    status: 'viavel',
    note: 'Dados estruturados (JSON-LD Product/Offer) na página do produto. Frete não disponível.',
  },
  {
    key: 'carrefour',
    label: 'Carrefour',
    domains: ['carrefour.com.br'],
    adapter: 'jsonld',
    status: 'viavel',
    note: 'JSON-LD Product/Offer na página do produto. Vendedor e frete não informados.',
  },
  {
    key: 'fastshop',
    label: 'Fast Shop',
    domains: ['fastshop.com.br'],
    adapter: 'vtex',
    status: 'viavel',
    note: 'Catálogo público da plataforma VTEX: preço, vendedor, estoque e parcelamento. Frete não disponível.',
  },
  {
    key: 'amazon',
    label: 'Amazon BR',
    domains: ['amazon.com.br'],
    adapter: 'amazon',
    status: 'parcial',
    note: 'Preço lido do HTML da página; pode exigir verificação e deixar de funcionar. Prefira conferir manualmente.',
  },
  {
    key: 'casasbahia',
    label: 'Casas Bahia',
    domains: ['casasbahia.com.br'],
    adapter: null,
    status: 'indisponivel',
    note: 'A loja bloqueia leitura automática (HTTP 403). Use o preço manual.',
  },
  {
    key: 'pontofrio',
    label: 'Pontofrio',
    domains: ['pontofrio.com.br'],
    adapter: null,
    status: 'indisponivel',
    note: 'A loja bloqueia leitura automática (HTTP 403). Use o preço manual.',
  },
  {
    key: 'magalu',
    label: 'Magalu',
    domains: ['magazineluiza.com.br', 'magalu.com'],
    adapter: null,
    status: 'indisponivel',
    note: 'A loja bloqueia leitura automática (HTTP 403). Use o preço manual.',
  },
  {
    key: 'mercadolivre',
    label: 'Mercado Livre',
    domains: ['mercadolivre.com.br', 'mercadolivre.com'],
    adapter: null,
    status: 'indisponivel',
    note: 'Página exige verificação de conta e a API exige credencial própria. Use o preço manual.',
  },
]

export class UrlRejected extends Error {}

export function findStoreByHost(host: string): StoreDef | null {
  const h = host.toLowerCase().replace(/\.$/, '')
  return STORES.find((s) => s.domains.some((d) => h === d || h.endsWith('.' + d))) ?? null
}

/** Valida URL de loja: https, sem credenciais, sem IP literal, porta padrão e domínio da lista. */
export function parseStoreUrl(raw: string): { url: URL; store: StoreDef } {
  let url: URL
  try {
    url = new URL(String(raw).trim())
  } catch {
    throw new UrlRejected('Link inválido. Cole o endereço completo do produto (começando com https://).')
  }
  if (url.protocol !== 'https:') throw new UrlRejected('Use um link https:// da loja.')
  if (url.username || url.password) throw new UrlRejected('Links com usuário/senha não são aceitos.')
  if (url.port && url.port !== '443') throw new UrlRejected('Porta não permitida no link.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) throw new UrlRejected('Use o endereço da loja, não um IP.')
  const store = findStoreByHost(host)
  if (!store) {
    throw new UrlRejected(
      'Loja não reconhecida. Lojas aceitas: ' + STORES.map((s) => s.label).join(', ') + '. Para outras, use cadastro manual.',
    )
  }
  url.hash = ''
  return { url, store }
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT / Tailscale
      (a === 169 && b === 254) || // link-local / metadados
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === '::' || v === '::1') return true
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7))
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v)
  }
  return true
}

export type Resolver = (host: string) => Promise<string[]>
export const defaultResolver: Resolver = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address)

/** Garante que o host resolve só para IPs públicos (proteção contra SSRF/rebinding básico). */
export async function assertPublicHost(host: string, resolve: Resolver = defaultResolver) {
  let addrs: string[]
  try {
    addrs = await resolve(host)
  } catch {
    throw new UrlRejected('Não foi possível resolver o endereço da loja.')
  }
  if (!addrs.length || addrs.some(isPrivateIp)) throw new UrlRejected('Destino de rede não permitido.')
}
