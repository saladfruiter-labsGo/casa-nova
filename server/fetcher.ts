import { assertPublicHost, findStoreByHost, Resolver, defaultResolver, UrlRejected } from './stores.ts'

export interface FetchResult {
  status: number
  url: string
  text: string
}
export type Fetcher = (url: URL, accept?: string) => Promise<FetchResult>

export class CollectError extends Error {
  constructor(
    public kind: 'blocked' | 'not_found' | 'parse' | 'network' | 'captcha' | 'rejected' | 'variant_mismatch',
    message: string,
    public httpStatus?: number,
  ) {
    super(message)
  }
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CasaNova/0.1 (uso pessoal)'
const MAX_BYTES = 6 * 1024 * 1024
const MAX_REDIRECTS = 3

/** Intervalo mínimo entre requisições ao mesmo domínio (limite por domínio). */
const lastHit = new Map<string, number>()
export const DOMAIN_GAP_MS = Number(process.env.DOMAIN_GAP_MS ?? 15_000)

async function domainThrottle(host: string) {
  const store = findStoreByHost(host)
  const key = store?.key ?? host
  const wait = (lastHit.get(key) ?? 0) + DOMAIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastHit.set(key, Date.now())
}

/**
 * Fetch seguro: só domínios das lojas cadastradas, só IP público, redirecionamentos revalidados,
 * tempo e tamanho limitados. Nunca segue redirecionamento para fora da lista.
 */
export function createSafeFetcher(resolve: Resolver = defaultResolver, throttle = true): Fetcher {
  return async (start, accept = 'text/html,application/xhtml+xml') => {
    let url = new URL(start.toString())
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'https:' || !findStoreByHost(url.hostname)) {
        throw new CollectError('rejected', 'Redirecionamento para destino não permitido')
      }
      try {
        await assertPublicHost(url.hostname, resolve)
      } catch (e) {
        if (e instanceof UrlRejected) throw new CollectError('rejected', e.message)
        throw e
      }
      if (throttle) await domainThrottle(url.hostname)
      let res: Response
      try {
        res = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
          headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        })
      } catch (e) {
        throw new CollectError('network', 'Falha de rede ao acessar a loja: ' + (e as Error).name)
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) throw new CollectError('network', 'Redirecionamento sem destino')
        url = new URL(loc, url)
        continue
      }
      const buf = await readLimited(res)
      return { status: res.status, url: url.toString(), text: buf }
    }
    throw new CollectError('network', 'Redirecionamentos demais')
  }
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new CollectError('parse', 'Página grande demais')
    }
    chunks.push(value)
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks))
}

export function assertOk(r: FetchResult) {
  if (r.status === 403 || r.status === 429) throw new CollectError('blocked', `A loja recusou o acesso (HTTP ${r.status})`, r.status)
  if (r.status === 404 || r.status === 410) throw new CollectError('not_found', 'Produto não encontrado na loja (HTTP 404)', r.status)
  if (r.status >= 400) throw new CollectError('network', `Erro HTTP ${r.status} na loja`, r.status)
  if (/account-verification|validateCaptcha|captcha/i.test(r.url)) throw new CollectError('captcha', 'A loja pediu verificação (CAPTCHA)')
}
