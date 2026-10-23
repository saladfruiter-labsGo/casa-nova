import { DB, nowIso, tx, getSetting } from './db.ts'
import {
  AlertStateRow,
  DEFAULT_ALERT_CONFIG,
  NeedContext,
  NeedRow,
  ObservationRow,
  OfferRow,
  bestComparable,
  evaluateNeed,
} from './alerts.ts'
import { Collected, SellerOffer, adapterFor, pickSellerOffer } from './adapters/index.ts'
import { CollectError, Fetcher } from './fetcher.ts'
import { STORES, StoreDef, parseStoreUrl } from './stores.ts'
import { enqueueTelegram } from './notify.ts'
import crypto from 'node:crypto'

const H = 3600_000

export function intervalHours(db: DB): number {
  const v = Number(getSetting(db, 'interval_hours') ?? 6)
  return Number.isFinite(v) && v >= 1 ? v : 6
}

export function purchasedQty(db: DB, needId: number): number {
  return Number((db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM purchases WHERE need_id = ?').get(needId) as { q: number }).q)
}

export function loadNeedContext(db: DB, needId: number): NeedContext | null {
  const need = db.prepare('SELECT * FROM needs WHERE id = ?').get(needId) as unknown as NeedRow | undefined
  if (!need) return null
  const offers = db.prepare('SELECT * FROM offers WHERE need_id = ? ORDER BY id').all(needId) as unknown as OfferRow[]
  const obsStmt = db.prepare('SELECT * FROM observations WHERE offer_id = ? ORDER BY observed_at, id')
  return {
    need,
    remainingQty: need.quantity - purchasedQty(db, needId),
    offers: offers.map((offer) => ({ offer, observations: obsStmt.all(offer.id) as unknown as ObservationRow[] })),
  }
}

/** Avalia regras e grava alertas + outbox + estado na mesma transação (chamar dentro de tx). */
export function runAlertsForNeed(db: DB, needId: number, now = new Date()): number {
  const ctx = loadNeedContext(db, needId)
  if (!ctx) return 0
  const states = new Map<string, AlertStateRow>()
  for (const s of db.prepare("SELECT * FROM alert_state WHERE key LIKE '%:%'").all() as unknown as AlertStateRow[]) states.set(s.key, s)
  const { events, states: next } = evaluateNeed(ctx, states, now, DEFAULT_ALERT_CONFIG)
  const up = db.prepare(
    `INSERT INTO alert_state(key, active, last_sent_at, last_value_cents, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET active=excluded.active, last_sent_at=excluded.last_sent_at,
       last_value_cents=excluded.last_value_cents, updated_at=excluded.updated_at`,
  )
  for (const s of next) up.run(s.key, s.active, s.last_sent_at, s.last_value_cents, now.toISOString())
  let created = 0
  const ins = db.prepare(
    'INSERT OR IGNORE INTO alerts(dedupe_key, need_id, offer_id, kind, title, body, url, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
  for (const e of events) {
    const r = ins.run(e.dedupeKey, e.needId, e.offerId, e.kind, e.title, e.body, e.url, now.toISOString())
    if (r.changes > 0) {
      created++
      enqueueTelegram(db, `alert:${e.dedupeKey}`, `🔔 ${e.title}\n\n${e.body}${e.url ? `\n\n${e.url}` : ''}`, now)
    }
  }
  return created
}

// ------------------------------------------------------------------ coleta

export interface CollectDeps {
  fetcher: Fetcher
  now?: () => Date
}

export interface Preview {
  id: string
  url: string
  store: StoreDef
  collected: Collected
  chosen: SellerOffer | null
  createdAt: number
}
const previews = new Map<string, Preview>()

export async function previewUrl(rawUrl: string, deps: CollectDeps): Promise<Preview> {
  const { url, store } = parseStoreUrl(rawUrl)
  const adapter = adapterFor(store)
  if (!adapter) throw new CollectError('blocked', `${store.label}: ${store.note}`)
  const collected = await adapter(url, deps.fetcher)
  const p: Preview = {
    id: crypto.randomUUID(),
    url: url.toString(),
    store,
    collected,
    chosen: pickSellerOffer(collected, null),
    createdAt: Date.now(),
  }
  for (const [k, v] of previews) if (Date.now() - v.createdAt > 30 * 60_000) previews.delete(k)
  previews.set(p.id, p)
  return p
}

export function getPreview(id: string): Preview | undefined {
  const p = previews.get(id)
  if (p && Date.now() - p.createdAt > 30 * 60_000) {
    previews.delete(id)
    return undefined
  }
  return p
}

function insertObservation(
  db: DB,
  offerId: number,
  so: SellerOffer,
  c: Collected | null,
  source: 'auto' | 'manual',
  at: Date,
  extra: { shipping_cents?: number | null; shipping_known?: boolean; conditional?: boolean; conditional_note?: string | null; note?: string | null } = {},
) {
  const cep = getSetting(db, 'cep')
  return db
    .prepare(
      `INSERT INTO observations(offer_id, observed_at, source, price_cash_cents, price_installment_total_cents, installments,
        shipping_cents, shipping_known, availability, seller, conditional, conditional_note, cep, external_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      offerId,
      at.toISOString(),
      source,
      so.priceCashCents,
      so.priceInstallmentTotalCents,
      so.installments,
      extra.shipping_known ? extra.shipping_cents ?? null : null,
      extra.shipping_known ? 1 : 0,
      so.availability,
      so.seller,
      extra.conditional ? 1 : 0,
      extra.conditional_note ?? null,
      cep,
      c?.externalId ?? null,
      extra.note ?? null,
    )
}

function nextCheck(db: DB, now: Date): string {
  const base = intervalHours(db) * H
  return new Date(now.getTime() + base + Math.floor(Math.random() * base * 0.2)).toISOString()
}

export function createOfferFromPreview(
  db: DB,
  needId: number,
  previewId: string,
  opts: { lockSeller: boolean; variantConfirmed: boolean },
  now = new Date(),
): number {
  const p = getPreview(previewId)
  if (!p) throw new CollectError('parse', 'A leitura do link expirou. Cole o link novamente.')
  if (!opts.variantConfirmed) throw new CollectError('parse', 'Confirme que o produto e a variante estão corretos.')
  const so = p.chosen
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO offers(need_id, store, store_label, url, external_id, seller, title, image_url, source, monitoring, status,
          last_checked_at, last_valid_at, next_check_at, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'auto', 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        needId,
        p.store.key,
        p.store.label,
        p.url,
        p.collected.externalId,
        opts.lockSeller && so?.seller ? so.seller : null,
        p.collected.title,
        p.collected.imageUrl,
        so?.availability === 'in_stock' ? 'active' : 'unavailable',
        now.toISOString(),
        now.toISOString(),
        nextCheck(db, now),
        now.toISOString(),
      )
    const offerId = Number(r.lastInsertRowid)
    if (so) insertObservation(db, offerId, so, p.collected, 'auto', now)
    const need = db.prepare('SELECT image_url, ean FROM needs WHERE id = ?').get(needId) as { image_url: string | null; ean: string | null }
    if (!need.image_url && p.collected.imageUrl) db.prepare('UPDATE needs SET image_url = ? WHERE id = ?').run(p.collected.imageUrl, needId)
    if (!need.ean && p.collected.ean) db.prepare('UPDATE needs SET ean = ? WHERE id = ?').run(p.collected.ean, needId)
    previews.delete(previewId)
    runAlertsForNeed(db, needId, now)
    return offerId
  })
}

export function createManualOffer(
  db: DB,
  needId: number,
  input: { store: string; store_label?: string | null; url?: string | null; seller?: string | null },
  now = new Date(),
): number {
  const known = STORES.find((s) => s.key === input.store)
  let url: string | null = null
  if (input.url) {
    try {
      url = parseStoreUrl(input.url).url.toString()
    } catch {
      // link manual de outra loja: aceito só como referência https, nunca coletado
      const u = new URL(input.url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new CollectError('rejected', 'Link inválido')
      url = u.toString()
    }
  }
  const r = db
    .prepare(
      `INSERT INTO offers(need_id, store, store_label, url, seller, source, monitoring, status, created_at)
       VALUES (?,?,?,?,?, 'manual', 0, 'manual', ?)`,
    )
    .run(needId, known?.key ?? 'outra', input.store_label || known?.label || 'Outra loja', url, input.seller ?? null, now.toISOString())
  return Number(r.lastInsertRowid)
}

export function addManualObservation(
  db: DB,
  offerId: number,
  input: {
    price_cash_cents: number | null
    price_installment_total_cents: number | null
    installments: number | null
    shipping_cents: number | null
    shipping_known: boolean
    availability: 'in_stock' | 'out_of_stock' | 'unknown'
    seller: string | null
    conditional: boolean
    conditional_note: string | null
    note: string | null
  },
  now = new Date(),
) {
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as unknown as OfferRow | undefined
  if (!offer) throw new Error('Oferta não encontrada')
  return tx(db, () => {
    const r = insertObservation(
      db,
      offerId,
      {
        seller: input.seller ?? offer.seller,
        priceCashCents: input.price_cash_cents,
        priceInstallmentTotalCents: input.price_installment_total_cents,
        installments: input.installments,
        availability: input.availability,
      },
      null,
      'manual',
      now,
      input,
    )
    if (offer.source === 'manual') db.prepare('UPDATE offers SET last_valid_at = ?, last_checked_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), offerId)
    runAlertsForNeed(db, offer.need_id, now)
    return Number(r.lastInsertRowid)
  })
}

/** Coleta uma oferta automática. Falhas preservam a última leitura válida e nunca viram preço zero. */
export async function collectOffer(db: DB, offerId: number, deps: CollectDeps): Promise<{ ok: boolean; error?: string }> {
  const now = deps.now?.() ?? new Date()
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) as unknown as (OfferRow & { external_id: string | null; consecutive_failures: number }) | undefined
  if (!offer || offer.source !== 'auto' || !offer.url) return { ok: false, error: 'Oferta sem coleta automática' }
  const t0 = Date.now()
  try {
    const { url, store } = parseStoreUrl(offer.url)
    const adapter = adapterFor(store)
    if (!adapter) throw new CollectError('blocked', store.note)
    const c = await adapter(url, deps.fetcher)
    if (offer.external_id && c.externalId && offer.external_id !== c.externalId) {
      throw new CollectError('variant_mismatch', `A loja agora mostra outra variante (${c.externalId} em vez de ${offer.external_id})`)
    }
    const so = pickSellerOffer(c, offer.seller)
    const done = new Date()
    tx(db, () => {
      if (so) insertObservation(db, offerId, so, c, 'auto', done)
      else
        insertObservation(
          db,
          offerId,
          { seller: offer.seller, priceCashCents: null, priceInstallmentTotalCents: null, installments: null, availability: 'out_of_stock' },
          c,
          'auto',
          done,
          { note: 'Vendedor escolhido não está mais ofertando' },
        )
      db.prepare(
        `UPDATE offers SET status = ?, consecutive_failures = 0, last_checked_at = ?, last_valid_at = ?, last_error = NULL,
           next_check_at = ?, locked_until = NULL WHERE id = ?`,
      ).run(so?.availability === 'in_stock' ? 'active' : 'unavailable', done.toISOString(), done.toISOString(), nextCheck(db, done), offerId)
      db.prepare('INSERT INTO fetch_log(offer_id, at, ok, http_status, duration_ms) VALUES (?,?,1,200,?)').run(offerId, done.toISOString(), Date.now() - t0)
      runAlertsForNeed(db, offer.need_id, done)
    })
    return { ok: true }
  } catch (e) {
    const err = e instanceof CollectError ? e : new CollectError('network', 'Erro inesperado na coleta')
    if (!(e instanceof CollectError)) console.error('[coleta] erro inesperado', (e as Error).message)
    const failures = offer.consecutive_failures + 1
    const hard = err.kind === 'variant_mismatch' || err.kind === 'rejected' || failures >= 3
    const backoffH = failures === 1 ? 1 : failures === 2 ? 3 : 24
    db.prepare(
      `UPDATE offers SET status = ?, consecutive_failures = ?, last_checked_at = ?, last_error = ?, next_check_at = ?, locked_until = NULL WHERE id = ?`,
    ).run(
      hard ? 'needs_attention' : 'stale',
      failures,
      now.toISOString(),
      err.message,
      new Date(now.getTime() + (hard ? 24 : backoffH) * H).toISOString(),
      offerId,
    )
    db.prepare('INSERT INTO fetch_log(offer_id, at, ok, http_status, duration_ms, error) VALUES (?,?,0,?,?,?)').run(
      offerId,
      now.toISOString(),
      err.httpStatus ?? null,
      Date.now() - t0,
      `${err.kind}: ${err.message}`,
    )
    return { ok: false, error: err.message }
  }
}

// ------------------------------------------------------------------ leitura para a interface

export type MonitorStatus = 'manual' | 'ativo' | 'atrasado' | 'indisponivel' | 'requer_intervencao' | 'pausado' | 'aguardando'

export function monitorStatus(
  o: OfferRow & { monitoring: number; last_valid_at: string | null },
  need: { monitoring_paused: number },
  intervalH: number,
  now = new Date(),
): MonitorStatus {
  if (o.source === 'manual') return 'manual'
  if (need.monitoring_paused || !o.monitoring) return 'pausado'
  if (o.status === 'needs_attention') return 'requer_intervencao'
  if (!o.last_valid_at) return 'aguardando'
  if (now.getTime() - new Date(o.last_valid_at).getTime() > intervalH * 2 * H) return 'atrasado'
  if (o.status === 'unavailable') return 'indisponivel'
  if (o.status === 'stale') return 'atrasado'
  return 'ativo'
}

export function needStatus(need: NeedRow & { quantity: number }, purchased: number, delivered: number, hasMonitor: boolean) {
  if (need.cancelled) return 'cancelado'
  if (purchased >= need.quantity) return delivered >= need.quantity ? 'entregue' : 'comprado'
  return hasMonitor && !need.monitoring_paused ? 'monitorando' : 'planejado'
}

export function bestFor(db: DB, needId: number, now = new Date()) {
  const ctx = loadNeedContext(db, needId)
  if (!ctx) return null
  return bestComparable(ctx, now)
}
