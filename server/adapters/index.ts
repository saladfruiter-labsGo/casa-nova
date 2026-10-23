import { CollectError, Fetcher, assertOk } from '../fetcher.ts'
import { toCents } from '../money.ts'
import type { StoreDef } from '../stores.ts'

export type Availability = 'in_stock' | 'out_of_stock' | 'unknown'

export interface SellerOffer {
  seller: string | null
  priceCashCents: number | null
  priceInstallmentTotalCents: number | null
  installments: number | null
  availability: Availability
}

export interface Collected {
  title: string | null
  imageUrl: string | null
  externalId: string | null // SKU/ASIN/variante na loja
  ean: string | null
  brand: string | null
  offers: SellerOffer[] // uma por vendedor quando a loja informa
}

export type Adapter = (url: URL, fetcher: Fetcher) => Promise<Collected>

// ---------------------------------------------------------------- JSON-LD

function mapAvailability(v: unknown): Availability {
  const s = String(v ?? '').toLowerCase()
  if (/instock|limitedavailability|onlineonly|presale|preorder/.test(s)) return 'in_stock'
  if (/outofstock|soldout|discontinued/.test(s)) return 'out_of_stock'
  return 'unknown'
}

function findProducts(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => findProducts(n, out))
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    const t = o['@type']
    if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) out.push(o)
    if (o['@graph']) findProducts(o['@graph'], out)
  }
  return out
}

export function parseJsonLd(html: string): Collected {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const products: Record<string, unknown>[] = []
  for (const b of blocks) {
    try {
      findProducts(JSON.parse(b[1].trim()), products)
    } catch {
      /* bloco inválido: ignora */
    }
  }
  const p = products[0]
  if (!p) throw new CollectError('parse', 'A página não tem dados estruturados de produto')
  const rawOffers = p.offers
  const list = (Array.isArray(rawOffers) ? rawOffers : rawOffers ? [rawOffers] : []) as Record<string, unknown>[]
  const offers: SellerOffer[] = list.map((o) => {
    const availability = mapAvailability(o.availability)
    let price = toCents(o.price ?? o.lowPrice ?? null)
    if (typeof o.price === 'string') price = toCents(o.price.includes(',') ? o.price : Number(o.price))
    if (o.priceCurrency && o.priceCurrency !== 'BRL') price = null
    // Preço zero nunca é preço real: lojas publicam 0 quando o item está indisponível.
    if (price === 0) price = null
    const seller = (o.seller as Record<string, unknown> | undefined)?.name
    return {
      seller: typeof seller === 'string' ? seller : null,
      priceCashCents: price,
      priceInstallmentTotalCents: null,
      installments: null,
      availability: price === null && availability === 'in_stock' ? 'unknown' : availability,
    }
  })
  const img = Array.isArray(p.image) ? p.image[0] : p.image
  const brand = typeof p.brand === 'object' && p.brand ? (p.brand as Record<string, unknown>).name : p.brand
  const gtin = [p.gtin13, p.gtin, p.gtin14, p.gtin12, p.mpn].map((x) => (x == null ? '' : String(x))).find((x) => /^\d{8,14}$/.test(x))
  return {
    title: typeof p.name === 'string' ? p.name : null,
    imageUrl: typeof img === 'string' ? img : (img as Record<string, string> | undefined)?.url ?? null,
    externalId: p.sku != null ? String(p.sku) : null,
    ean: gtin ?? null,
    brand: typeof brand === 'string' ? brand : null,
    offers,
  }
}

export const jsonLdAdapter: Adapter = async (url, fetcher) => {
  const r = await fetcher(url)
  assertOk(r)
  return parseJsonLd(r.text)
}

// ---------------------------------------------------------------- VTEX (catálogo público)

interface VtexSeller {
  sellerName: string
  sellerDefault?: boolean
  commertialOffer: {
    Price: number
    ListPrice?: number
    AvailableQuantity: number
    Installments?: { NumberOfInstallments: number; InterestRate: number; TotalValuePlusInterestRate: number }[]
  }
}
interface VtexItem {
  itemId: string
  name?: string
  ean?: string
  images?: { imageUrl: string }[]
  sellers: VtexSeller[]
}
interface VtexProduct {
  productName: string
  brand?: string
  items: VtexItem[]
}

export function vtexSlug(url: URL): string {
  const m = url.pathname.match(/^\/([^/]+)\/p\/?$/)
  if (!m) throw new CollectError('parse', 'Link não parece ser de uma página de produto (esperado …/nome-do-produto/p)')
  return m[1]
}

export function parseVtex(json: string, skuId: string | null): Collected {
  let data: VtexProduct[]
  try {
    data = JSON.parse(json)
  } catch {
    throw new CollectError('parse', 'Resposta inesperada do catálogo da loja')
  }
  const p = data[0]
  if (!p) throw new CollectError('not_found', 'Produto não encontrado no catálogo da loja')
  let item: VtexItem | undefined
  if (skuId) item = p.items.find((i) => i.itemId === skuId)
  else if (p.items.length === 1) item = p.items[0]
  else item = p.items[0]
  if (!item) throw new CollectError('variant_mismatch', 'A variante (SKU) indicada no link não existe mais')
  const offers: SellerOffer[] = item.sellers.map((s) => {
    const co = s.commertialOffer
    const avail = co.AvailableQuantity > 0 && co.Price > 0
    const noInterest = (co.Installments ?? []).filter((i) => i.InterestRate === 0)
    const best = noInterest.sort((a, b) => b.NumberOfInstallments - a.NumberOfInstallments)[0]
    return {
      seller: s.sellerName,
      priceCashCents: avail ? toCents(co.Price) : null,
      priceInstallmentTotalCents: avail && best && best.NumberOfInstallments > 1 ? toCents(best.TotalValuePlusInterestRate) : null,
      installments: avail && best && best.NumberOfInstallments > 1 ? best.NumberOfInstallments : null,
      availability: avail ? 'in_stock' : 'out_of_stock',
    }
  })
  return {
    title: item.name && item.name !== p.productName ? `${p.productName} — ${item.name}` : p.productName,
    imageUrl: item.images?.[0]?.imageUrl ?? null,
    externalId: item.itemId,
    ean: item.ean || null,
    brand: p.brand ?? null,
    offers,
  }
}

export const vtexAdapter: Adapter = async (url, fetcher) => {
  const slug = vtexSlug(url)
  const sku = url.searchParams.get('skuId') ?? url.searchParams.get('idsku')
  const api = new URL(`/api/catalog_system/pub/products/search/${encodeURIComponent(slug)}/p`, url.origin)
  const r = await fetcher(api, 'application/json')
  if (r.status === 206) r.status = 200 // VTEX responde 206 para respostas paginadas
  assertOk(r)
  return parseVtex(r.text, sku)
}

// ---------------------------------------------------------------- Amazon (HTML, parcial)

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function amazonAsin(url: URL): string | null {
  return url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ?? null
}

export function parseAmazon(html: string, asin: string | null): Collected {
  if (/validateCaptcha|Digite os caracteres que você vê|api-services-support@amazon/i.test(html)) {
    throw new CollectError('captcha', 'A Amazon pediu verificação (CAPTCHA)')
  }
  const title = html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/)?.[1]
  if (!title) throw new CollectError('parse', 'Não encontrei o produto na página da Amazon')
  // Preço principal da caixa de compra
  const core = html.match(/id="corePrice(?:Display_desktop)?_feature_div"[\s\S]{0,4000}?class="a-offscreen">([^<]+)</)?.[1]
  const priceAmount = html.match(/"priceAmount":\s*([\d.]+)/)?.[1]
  const price = core ? toCents(decode(core)) : priceAmount ? toCents(Number(priceAmount)) : null
  const availText = decode(html.match(/id="availability"[\s\S]{0,600}?<span[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '')
  let availability: Availability = 'unknown'
  if (/em estoque|disponível para envio|restam? apenas/i.test(availText)) availability = 'in_stock'
  else if (/não disponível|indisponível|sem estoque/i.test(availText)) availability = 'out_of_stock'
  else if (price !== null && /id="add-to-cart-button"/.test(html)) availability = 'in_stock'
  const seller =
    html.match(/id="sellerProfileTriggerId"[^>]*>([^<]+)</)?.[1] ??
    (/Vendido por[\s\S]{0,200}Amazon\.com\.br/i.test(html) || /"merchantName":"Amazon/i.test(html) ? 'Amazon.com.br' : null)
  const img = html.match(/id="landingImage"[^>]*src="([^"]+)"/)?.[1] ?? null
  return {
    title: decode(title),
    imageUrl: img,
    externalId: asin,
    ean: null,
    brand: null,
    offers: [
      {
        seller: seller ? decode(seller) : null,
        priceCashCents: availability === 'out_of_stock' ? null : price,
        priceInstallmentTotalCents: null,
        installments: null,
        availability: price === null && availability === 'in_stock' ? 'unknown' : availability,
      },
    ],
  }
}

export const amazonAdapter: Adapter = async (url, fetcher) => {
  const asin = amazonAsin(url)
  if (!asin) throw new CollectError('parse', 'Link da Amazon sem código do produto (/dp/XXXXXXXXXX)')
  const r = await fetcher(new URL(`https://www.amazon.com.br/dp/${asin}`))
  assertOk(r)
  return parseAmazon(r.text, asin)
}

export function adapterFor(store: StoreDef): Adapter | null {
  switch (store.adapter) {
    case 'jsonld':
      return jsonLdAdapter
    case 'vtex':
      return vtexAdapter
    case 'amazon':
      return amazonAdapter
    default:
      return null
  }
}

/** Escolhe a oferta do vendedor travado, ou a melhor disponível quando não há trava. */
export function pickSellerOffer(c: Collected, lockedSeller: string | null): SellerOffer | null {
  if (lockedSeller) {
    const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
    return c.offers.find((o) => norm(o.seller) === norm(lockedSeller)) ?? null
  }
  const avail = c.offers.filter((o) => o.availability === 'in_stock' && o.priceCashCents !== null)
  if (avail.length) return avail.sort((a, b) => a.priceCashCents! - b.priceCashCents!)[0]
  return c.offers[0] ?? null
}
