import { Hono, Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { DB, getSetting, setSetting, snapshot, tx, SCHEMA_VERSION, getSchemaVersion } from './db.ts'
import {
  CollectDeps,
  addManualObservation,
  bestFor,
  collectOffer,
  createManualOffer,
  createOfferFromPreview,
  intervalHours,
  monitorStatus,
  needStatus,
  previewUrl,
  runAlertsForNeed,
} from './core.ts'
import { CollectError } from './fetcher.ts'
import { STORES, UrlRejected } from './stores.ts'
import { toCents } from './money.ts'
import { createSession, deleteSession, loginBlocked, registerFailure, resetFailures, validSession, verifyPassword } from './auth.ts'
import { TelegramApi, checkLinkCode, createLinkCode, enqueueTelegram, processOutbox, realTelegramApi, telegramChatId, telegramToken } from './notify.ts'
import { toCsv } from './csv.ts'
import type { NeedRow, ObservationRow, OfferRow } from './alerts.ts'
import fs from 'node:fs'

export interface AppDeps extends CollectDeps {
  db: DB
  passwordHash: string
  version: string
  cookieSecure?: boolean
  telegram?: TelegramApi
  backupDir?: string
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
const bad = (m: string) => new HttpError(400, m)
const notFound = (m = 'Não encontrado') => new HttpError(404, m)

// ---------------------------------------------------------------- validação simples
type Body = Record<string, unknown>
const str = (v: unknown, max = 500): string | null => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (!s) return null
  if (s.length > max) throw bad('Texto longo demais')
  return s
}
const int = (v: unknown, min = 0, max = 1e9): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw bad('Número inválido')
  return n
}
const cents = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  const c = toCents(v)
  if (c === null) throw bad('Valor em reais inválido')
  return c
}
const bool = (v: unknown) => (v ? 1 : 0)
const date = (v: unknown): string | null => {
  const s = str(v, 30)
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad('Data inválida')
  return s
}
const oneOf = <T extends string>(v: unknown, opts: readonly T[], def: T): T => (opts.includes(v as T) ? (v as T) : def)

const NEED_FIELDS = {
  title: (v: unknown) => {
    const s = str(v, 200)
    if (!s) throw bad('Informe o nome do produto')
    return s
  },
  room_id: (v: unknown) => int(v, 1),
  category_id: (v: unknown) => int(v, 1),
  quantity: (v: unknown) => int(v, 1, 999) ?? 1,
  priority: (v: unknown) => int(v, 1, 3) ?? 2,
  desired_date: date,
  budget_cents: cents,
  notes: (v: unknown) => str(v, 4000),
  brand: (v: unknown) => str(v, 120),
  model: (v: unknown) => str(v, 120),
  ean: (v: unknown) => str(v, 20),
  voltage: (v: unknown) => str(v, 40),
  color: (v: unknown) => str(v, 60),
  dimensions: (v: unknown) => str(v, 120),
  variant_notes: (v: unknown) => str(v, 500),
  image_url: (v: unknown) => {
    const s = str(v, 1000)
    if (s && !/^https:\/\//.test(s)) throw bad('Imagem precisa ser um link https')
    return s
  },
  target_price_cents: cents,
  target_mode: (v: unknown) => oneOf(v, ['item', 'total'] as const, 'item'),
  price_basis: (v: unknown) => oneOf(v, ['cash', 'installment'] as const, 'cash'),
  accept_conditional: bool,
  alert_drop_pct: (v: unknown) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    if (!(n > 0 && n < 100)) throw bad('Queda percentual deve estar entre 1 e 99')
    return n
  },
  alert_restock: bool,
  monitoring_paused: bool,
  cancelled: bool,
} as const

export function createApp(deps: AppDeps) {
  const { db } = deps
  const app = new Hono()
  const telegram = deps.telegram ?? realTelegramApi

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400)
    if (err instanceof UrlRejected) return c.json({ error: err.message }, 400)
    if (err instanceof CollectError) return c.json({ error: err.message, kind: err.kind }, 422)
    console.error('[api]', err)
    return c.json({ error: 'Erro interno. Seus dados não foram perdidos; tente novamente.' }, 500)
  })

  app.get('/api/health', (c) => {
    db.prepare('SELECT 1').get()
    return c.json({ ok: true, version: deps.version, schema: getSchemaVersion(db), schemaExpected: SCHEMA_VERSION })
  })

  // ------------------------------------------------------------ autenticação
  app.post('/api/auth/login', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local'
    if (loginBlocked(ip)) return c.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429)
    const body = (await c.req.json().catch(() => ({}))) as Body
    if (typeof body.password !== 'string' || !verifyPassword(body.password, deps.passwordHash)) {
      registerFailure(ip)
      return c.json({ error: 'Senha incorreta' }, 401)
    }
    resetFailures(ip)
    setCookie(c, 'cn_session', createSession(db), {
      httpOnly: true,
      sameSite: 'Strict',
      secure: !!deps.cookieSecure,
      path: '/',
      maxAge: 30 * 86400,
    })
    return c.json({ ok: true })
  })

  app.use('/api/*', async (c, next) => {
    const p = c.req.path
    if (p === '/api/health' || p === '/api/auth/login') return next()
    if (!validSession(db, getCookie(c, 'cn_session'))) return c.json({ error: 'Faça login' }, 401)
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin')
      const host = c.req.header('host')
      if (origin && host && new URL(origin).host !== host) return c.json({ error: 'Origem não permitida' }, 403)
      const ct = c.req.header('content-type') ?? ''
      if (c.req.method !== 'DELETE' && !ct.includes('application/json')) return c.json({ error: 'Envie JSON' }, 415)
    }
    return next()
  })

  app.get('/api/auth/me', (c) => c.json({ ok: true }))
  app.post('/api/auth/logout', (c) => {
    deleteSession(db, getCookie(c, 'cn_session'))
    deleteCookie(c, 'cn_session', { path: '/' })
    return c.json({ ok: true })
  })

  const json = async (c: Context) => (await c.req.json().catch(() => ({}))) as Body
  const id = (c: Context, name = 'id') => {
    const n = Number(c.req.param(name))
    if (!Number.isInteger(n) || n < 1) throw notFound()
    return n
  }

  // ------------------------------------------------------------ cômodos e categorias
  for (const table of ['rooms', 'categories'] as const) {
    app.get(`/api/${table}`, (c) =>
      c.json(db.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'rooms' ? 'sort, name' : 'name'}`).all()),
    )
    app.post(`/api/${table}`, async (c) => {
      const b = await json(c)
      const name = str(b.name, 80)
      if (!name) throw bad('Informe o nome')
      try {
        const r =
          table === 'rooms'
            ? db.prepare('INSERT INTO rooms(name, budget_cents) VALUES (?,?)').run(name, cents(b.budget_cents))
            : db.prepare('INSERT INTO categories(name) VALUES (?)').run(name)
        return c.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(r.lastInsertRowid)), 201)
      } catch (e) {
        if (String(e).includes('UNIQUE')) throw bad('Já existe um item com esse nome')
        throw e
      }
    })
    app.patch(`/api/${table}/:id`, async (c) => {
      const b = await json(c)
      const rid = id(c)
      if (b.name !== undefined) {
        const name = str(b.name, 80)
        if (!name) throw bad('Informe o nome')
        db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, rid)
      }
      if (table === 'rooms' && b.budget_cents !== undefined) db.prepare('UPDATE rooms SET budget_cents = ? WHERE id = ?').run(cents(b.budget_cents), rid)
      return c.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rid) ?? null)
    })
    app.delete(`/api/${table}/:id`, (c) => {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id(c))
      return c.json({ ok: true })
    })
  }

  // ------------------------------------------------------------ necessidades/produtos
  const summarize = (n: NeedRow & Record<string, unknown>, now = new Date()) => {
    const offers = db.prepare("SELECT * FROM offers WHERE need_id = ? AND status != 'archived'").all(n.id) as unknown as (OfferRow & {
      monitoring: number
      last_valid_at: string | null
    })[]
    const p = db
      .prepare(
        `SELECT COALESCE(SUM(quantity),0) q, COALESCE(SUM(CASE WHEN delivered_at IS NOT NULL THEN quantity END),0) d,
                COALESCE(SUM(quantity*unit_price_cents + shipping_cents),0) spent FROM purchases WHERE need_id = ?`,
      )
      .get(n.id) as { q: number; d: number; spent: number }
    const ih = intervalHours(db)
    const statuses = offers.map((o) => monitorStatus(o, n, ih, now))
    const best = bestFor(db, n.id, now)
    // última cotação conhecida (pode estar desatualizada ou indisponível) — só para estimativa, nunca zero
    const last = db
      .prepare(
        `SELECT ob.*, o.store_label FROM observations ob JOIN offers o ON o.id = ob.offer_id
         WHERE o.need_id = ? AND o.status != 'archived' AND ob.price_cash_cents IS NOT NULL ORDER BY ob.observed_at DESC LIMIT 1`,
      )
      .get(n.id) as (ObservationRow & { store_label: string }) | undefined
    const hasMonitor = offers.some((o) => o.source === 'auto' && o.monitoring)
    const remaining = Math.max(0, n.quantity - p.q)
    const health = statuses.includes('requer_intervencao')
      ? 'requer_intervencao'
      : statuses.includes('atrasado')
        ? 'atrasado'
        : statuses.includes('ativo')
          ? 'ativo'
          : statuses.includes('indisponivel')
            ? 'indisponivel'
            : statuses.length
              ? statuses[0]
              : 'sem_ofertas'
    return {
      ...n,
      status: needStatus(n, p.q, p.d, hasMonitor),
      purchased_qty: p.q,
      delivered_qty: p.d,
      remaining_qty: remaining,
      spent_cents: p.spent,
      offers_count: offers.length,
      monitor_health: health,
      best: best
        ? {
            value_cents: best.value,
            offer_id: best.offer.id,
            store_label: best.offer.store_label,
            seller: best.obs.seller,
            observed_at: best.obs.observed_at,
            installments: best.obs.installments,
            conditional: !!best.obs.conditional,
          }
        : null,
      last_quote: last ? { value_cents: last.price_cash_cents, store_label: last.store_label, observed_at: last.observed_at } : null,
      at_target: !!best && n.target_price_cents !== null && best.value <= n.target_price_cents && remaining > 0 && !n.cancelled,
    }
  }

  const needQuery = `SELECT n.*, r.name AS room_name, k.name AS category_name FROM needs n
    LEFT JOIN rooms r ON r.id = n.room_id LEFT JOIN categories k ON k.id = n.category_id`

  app.get('/api/needs', (c) => {
    const q = c.req.query()
    const where: string[] = []
    const args: (string | number)[] = []
    if (q.room) where.push('n.room_id = ?'), args.push(Number(q.room))
    if (q.category) where.push('n.category_id = ?'), args.push(Number(q.category))
    if (q.priority) where.push('n.priority = ?'), args.push(Number(q.priority))
    if (q.q) {
      where.push("(n.title LIKE ? ESCAPE '\\' OR n.brand LIKE ? ESCAPE '\\' OR n.model LIKE ? ESCAPE '\\')")
      const like = `%${q.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
      args.push(like, like, like)
    }
    const rows = db
      .prepare(`${needQuery} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY n.cancelled, n.priority, n.desired_date IS NULL, n.desired_date, n.title`)
      .all(...args) as unknown as (NeedRow & Record<string, unknown>)[]
    let list = rows.map((r) => summarize(r))
    if (q.status) list = list.filter((n) => n.status === q.status)
    return c.json(list)
  })

  const writeNeed = (b: Body, partial: boolean) => {
    const out: Record<string, unknown> = {}
    for (const [k, fn] of Object.entries(NEED_FIELDS)) {
      if (partial && !(k in b)) continue
      out[k] = (fn as (v: unknown) => unknown)(b[k])
    }
    return out
  }

  app.post('/api/needs', async (c) => {
    const data = writeNeed(await json(c), false)
    const now = new Date().toISOString()
    const keys = Object.keys(data)
    const r = db
      .prepare(`INSERT INTO needs(${keys.join(',')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(',')}, ?, ?)`)
      .run(...(Object.values(data) as (string | number | null)[]), now, now)
    return c.json({ id: Number(r.lastInsertRowid) }, 201)
  })

  app.get('/api/needs/:id', (c) => {
    const nid = id(c)
    const n = db.prepare(`${needQuery} WHERE n.id = ?`).get(nid) as unknown as (NeedRow & Record<string, unknown>) | undefined
    if (!n) throw notFound('Produto não encontrado')
    const ih = intervalHours(db)
    const offers = (db.prepare('SELECT * FROM offers WHERE need_id = ? ORDER BY id').all(nid) as unknown as (OfferRow &
      Record<string, unknown> & { monitoring: number; last_valid_at: string | null })[]).map((o) => {
      const observations = db
        .prepare('SELECT * FROM observations WHERE offer_id = ? ORDER BY observed_at, id')
        .all(o.id) as unknown as ObservationRow[]
      return { ...o, monitor_status: monitorStatus(o, n, ih), latest: observations[observations.length - 1] ?? null, observations }
    })
    return c.json({
      ...summarize(n),
      offers,
      purchases: db.prepare('SELECT * FROM purchases WHERE need_id = ? ORDER BY purchased_at DESC, id DESC').all(nid),
      alerts: db.prepare('SELECT * FROM alerts WHERE need_id = ? ORDER BY created_at DESC LIMIT 20').all(nid),
      interval_hours: ih,
    })
  })

  app.patch('/api/needs/:id', async (c) => {
    const nid = id(c)
    const data = writeNeed(await json(c), true)
    if (!Object.keys(data).length) return c.json({ ok: true })
    const sets = Object.keys(data).map((k) => `${k} = ?`)
    tx(db, () => {
      const r = db
        .prepare(`UPDATE needs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...(Object.values(data) as (string | number | null)[]), new Date().toISOString(), nid)
      if (!r.changes) throw notFound()
      runAlertsForNeed(db, nid)
    })
    return c.json({ ok: true })
  })

  app.delete('/api/needs/:id', (c) => {
    const nid = id(c)
    const p = db.prepare('SELECT COUNT(*) n FROM purchases WHERE need_id = ?').get(nid) as { n: number }
    if (p.n > 0) throw bad('Este produto tem compras registradas. Use "Cancelar" para preservar o histórico.')
    db.prepare('DELETE FROM needs WHERE id = ?').run(nid)
    return c.json({ ok: true })
  })

  // ------------------------------------------------------------ ofertas
  app.get('/api/stores', (c) => c.json(STORES))

  app.post('/api/offers/preview', async (c) => {
    const b = await json(c)
    const p = await previewUrl(String(b.url ?? ''), deps)
    return c.json({
      preview_id: p.id,
      url: p.url,
      store: { key: p.store.key, label: p.store.label, status: p.store.status, note: p.store.note },
      title: p.collected.title,
      image_url: p.collected.imageUrl,
      external_id: p.collected.externalId,
      ean: p.collected.ean,
      brand: p.collected.brand,
      chosen: p.chosen,
      sellers: p.collected.offers,
    })
  })

  app.post('/api/needs/:id/offers', async (c) => {
    const nid = id(c)
    if (!db.prepare('SELECT 1 FROM needs WHERE id = ?').get(nid)) throw notFound()
    const b = await json(c)
    if (b.preview_id) {
      const oid = createOfferFromPreview(db, nid, String(b.preview_id), { lockSeller: !!b.lock_seller, variantConfirmed: !!b.variant_confirmed })
      return c.json({ id: oid }, 201)
    }
    const store = str(b.store, 40)
    if (!store) throw bad('Escolha a loja')
    const oid = createManualOffer(db, nid, { store, store_label: str(b.store_label, 80), url: str(b.url, 2000), seller: str(b.seller, 120) })
    return c.json({ id: oid }, 201)
  })

  app.patch('/api/offers/:id', async (c) => {
    const oid = id(c)
    const b = await json(c)
    const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(oid) as unknown as (OfferRow & { last_valid_at: string | null }) | undefined
    if (!o) throw notFound()
    tx(db, () => {
      if ('monitoring' in b) {
        if (b.monitoring && (o.source !== 'auto' || !o.last_valid_at)) throw bad('Monitoramento exige uma leitura automática válida desta oferta')
        db.prepare('UPDATE offers SET monitoring = ?, next_check_at = COALESCE(next_check_at, ?) WHERE id = ?').run(bool(b.monitoring), new Date().toISOString(), oid)
      }
      if ('shipping_cents_manual' in b) db.prepare('UPDATE offers SET shipping_cents_manual = ? WHERE id = ?').run(cents(b.shipping_cents_manual), oid)
      if ('archived' in b)
        db.prepare('UPDATE offers SET status = ?, monitoring = 0 WHERE id = ?').run(b.archived ? 'archived' : o.source === 'manual' ? 'manual' : 'pending', oid)
      if ('store_label' in b && o.source === 'manual') db.prepare('UPDATE offers SET store_label = ? WHERE id = ?').run(str(b.store_label, 80), oid)
      runAlertsForNeed(db, o.need_id)
    })
    return c.json({ ok: true })
  })

  app.post('/api/offers/:id/check', async (c) => {
    const oid = id(c)
    const o = db.prepare('SELECT source, last_manual_check_at FROM offers WHERE id = ?').get(oid) as
      | { source: string; last_manual_check_at: string | null }
      | undefined
    if (!o) throw notFound()
    if (o.source !== 'auto') throw bad('Esta oferta é manual: informe o preço novo.')
    if (o.last_manual_check_at && Date.now() - new Date(o.last_manual_check_at).getTime() < 10 * 60_000)
      return c.json({ error: 'Aguarde 10 minutos entre verificações manuais desta oferta.' }, 429)
    db.prepare('UPDATE offers SET last_manual_check_at = ? WHERE id = ?').run(new Date().toISOString(), oid)
    const r = await collectOffer(db, oid, deps)
    return c.json(r, r.ok ? 200 : 422)
  })

  app.post('/api/offers/:id/observations', async (c) => {
    const oid = id(c)
    const b = await json(c)
    const cash = cents(b.price_cash_cents)
    const inst = cents(b.price_installment_total_cents)
    const availability = oneOf(b.availability, ['in_stock', 'out_of_stock', 'unknown'] as const, 'in_stock')
    if (availability === 'in_stock' && cash === null && inst === null) throw bad('Informe o preço à vista ou o total parcelado')
    const shippingKnown = !!b.shipping_known
    const r = addManualObservation(db, oid, {
      price_cash_cents: cash,
      price_installment_total_cents: inst,
      installments: int(b.installments, 1, 48),
      shipping_cents: shippingKnown ? cents(b.shipping_cents) ?? 0 : null,
      shipping_known: shippingKnown,
      availability,
      seller: str(b.seller, 120),
      conditional: !!b.conditional,
      conditional_note: str(b.conditional_note, 200),
      note: str(b.note, 500),
    })
    return c.json({ id: r }, 201)
  })

  // ------------------------------------------------------------ compras
  app.get('/api/purchases', (c) =>
    c.json(
      db
        .prepare(
          `SELECT p.*, n.title, n.room_id, r.name AS room_name FROM purchases p JOIN needs n ON n.id = p.need_id
           LEFT JOIN rooms r ON r.id = n.room_id ORDER BY p.delivered_at IS NOT NULL, p.purchased_at DESC, p.id DESC`,
        )
        .all(),
    ),
  )

  app.post('/api/needs/:id/purchases', async (c) => {
    const nid = id(c)
    const b = await json(c)
    const need = db.prepare('SELECT quantity FROM needs WHERE id = ?').get(nid) as { quantity: number } | undefined
    if (!need) throw notFound()
    const qty = int(b.quantity, 1, 999) ?? 1
    const unit = cents(b.unit_price_cents)
    if (unit === null) throw bad('Informe o preço pago por unidade')
    const offerId = int(b.offer_id, 1)
    const label = offerId
      ? (db.prepare('SELECT store_label FROM offers WHERE id = ? AND need_id = ?').get(offerId, nid) as { store_label: string } | undefined)?.store_label
      : null
    const r = tx(db, () => {
      const res = db
        .prepare(
          'INSERT INTO purchases(need_id, offer_id, store_label, quantity, unit_price_cents, shipping_cents, purchased_at, delivered_at, notes) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          nid,
          offerId,
          str(b.store_label, 80) ?? label ?? null,
          qty,
          unit,
          cents(b.shipping_cents) ?? 0,
          date(b.purchased_at) ?? new Date().toISOString().slice(0, 10),
          date(b.delivered_at),
          str(b.notes, 1000),
        )
      runAlertsForNeed(db, nid)
      return res
    })
    return c.json({ id: Number(r.lastInsertRowid) }, 201)
  })

  app.patch('/api/purchases/:id', async (c) => {
    const pid = id(c)
    const b = await json(c)
    if ('delivered_at' in b) db.prepare('UPDATE purchases SET delivered_at = ? WHERE id = ?').run(date(b.delivered_at), pid)
    if ('notes' in b) db.prepare('UPDATE purchases SET notes = ? WHERE id = ?').run(str(b.notes, 1000), pid)
    return c.json({ ok: true })
  })

  app.delete('/api/purchases/:id', (c) => {
    db.prepare('DELETE FROM purchases WHERE id = ?').run(id(c))
    return c.json({ ok: true })
  })

  // ------------------------------------------------------------ painel
  app.get('/api/dashboard', (c) => {
    const needs = (db.prepare(`${needQuery} WHERE n.cancelled = 0`).all() as unknown as (NeedRow & Record<string, unknown>)[]).map((n) =>
      summarize(n),
    )
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, name').all() as { id: number; name: string; budget_cents: number | null }[]
    const group = (list: typeof needs) => {
      let estimate = 0
      let pendingQuote = 0
      for (const n of list) {
        if (n.remaining_qty <= 0) continue
        const unit = n.best?.value_cents ?? n.last_quote?.value_cents ?? null
        if (unit === null) pendingQuote++
        else estimate += unit * n.remaining_qty
      }
      return {
        items: list.length,
        planned: list.filter((n) => n.status === 'planejado' || n.status === 'monitorando').length,
        bought: list.filter((n) => n.status === 'comprado').length,
        delivered: list.filter((n) => n.status === 'entregue').length,
        spent_cents: list.reduce((a, n) => a + n.spent_cents, 0),
        estimate_remaining_cents: estimate,
        pending_quote: pendingQuote,
        needs_budget_cents: list.reduce((a, n) => a + ((n.budget_cents as number | null) ?? 0), 0),
      }
    }
    const byRoom = [
      ...rooms.map((r) => ({ room_id: r.id, name: r.name, budget_cents: r.budget_cents, ...group(needs.filter((n) => n.room_id === r.id)) })),
      { room_id: null, name: 'Sem cômodo', budget_cents: null, ...group(needs.filter((n) => !n.room_id)) },
    ].filter((r) => r.items > 0 || r.room_id !== null)
    const pending = needs.filter((n) => n.remaining_qty > 0)
    return c.json({
      totals: { ...group(needs), budget_cents: rooms.reduce((a, r) => a + (r.budget_cents ?? 0), 0) || null },
      by_room: byRoom,
      at_target: needs.filter((n) => n.at_target),
      next: pending
        .sort(
          (a, b) =>
            a.priority - b.priority || String(a.desired_date ?? '9999').localeCompare(String(b.desired_date ?? '9999')) || a.title.localeCompare(b.title),
        )
        .slice(0, 6),
      attention: needs.filter((n) => n.monitor_health === 'requer_intervencao' || n.monitor_health === 'atrasado'),
      unread_alerts: (db.prepare('SELECT COUNT(*) n FROM alerts WHERE read_at IS NULL').get() as { n: number }).n,
    })
  })

  // ------------------------------------------------------------ alertas
  app.get('/api/alerts', (c) =>
    c.json(
      db
        .prepare(
          `SELECT a.*, n.title AS need_title, (SELECT status FROM outbox WHERE dedupe_key = 'alert:' || a.dedupe_key) AS telegram_status
           FROM alerts a LEFT JOIN needs n ON n.id = a.need_id ORDER BY a.created_at DESC LIMIT 200`,
        )
        .all(),
    ),
  )
  app.post('/api/alerts/:id/read', (c) => {
    db.prepare('UPDATE alerts SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(new Date().toISOString(), id(c))
    return c.json({ ok: true })
  })
  app.post('/api/alerts/read-all', (c) => {
    db.prepare('UPDATE alerts SET read_at = ? WHERE read_at IS NULL').run(new Date().toISOString())
    return c.json({ ok: true })
  })

  // ------------------------------------------------------------ configurações
  app.get('/api/settings', (c) => {
    const lastSent = db.prepare(`SELECT sent_at FROM outbox WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1`).get() as { sent_at: string } | undefined
    const failedOutbox = (db.prepare(`SELECT COUNT(*) n FROM outbox WHERE status = 'failed'`).get() as { n: number }).n
    return c.json({
      cep: getSetting(db, 'cep'),
      interval_hours: intervalHours(db),
      telegram: {
        token_configured: !!telegramToken(),
        chat_linked: !!telegramChatId(db),
        chat_from_env: !!process.env.TELEGRAM_CHAT_ID,
        last_sent_at: lastSent?.sent_at ?? null,
        failed: failedOutbox,
      },
      version: deps.version,
    })
  })
  app.patch('/api/settings', async (c) => {
    const b = await json(c)
    if ('cep' in b) {
      const cep = str(b.cep, 9)?.replace(/\D/g, '') ?? null
      if (cep && cep.length !== 8) throw bad('CEP deve ter 8 dígitos')
      setSetting(db, 'cep', cep)
    }
    if ('interval_hours' in b) {
      const h = int(b.interval_hours, 3, 48)
      if (h === null) throw bad('Intervalo entre 3 e 48 horas')
      setSetting(db, 'interval_hours', String(h))
    }
    return c.json({ ok: true })
  })

  app.post('/api/telegram/link-code', (c) => {
    if (!telegramToken()) throw bad('Configure TELEGRAM_BOT_TOKEN no servidor primeiro')
    return c.json({ code: createLinkCode(db) })
  })
  app.post('/api/telegram/link-check', async (c) => c.json(await checkLinkCode(db, telegram)))
  app.delete('/api/telegram/link', (c) => {
    setSetting(db, 'telegram_chat_id', null)
    return c.json({ ok: true })
  })
  app.post('/api/telegram/test', async (c) => {
    if (!telegramToken() || !telegramChatId(db)) throw bad('Telegram ainda não está configurado')
    const key = `test:${Date.now()}`
    enqueueTelegram(db, key, '✅ Casa Nova: mensagem de teste. Se você recebeu, os alertas vão chegar aqui.')
    await processOutbox(db, telegram)
    const r = db.prepare('SELECT status, last_error FROM outbox WHERE dedupe_key = ?').get(key) as { status: string; last_error: string | null }
    if (r.status !== 'sent') return c.json({ ok: false, error: r.last_error ?? 'Envio pendente' }, 502)
    return c.json({ ok: true })
  })

  // ------------------------------------------------------------ exportação e backup
  app.get('/api/export/:kind{(needs|offers|observations|purchases)\\.csv}', (c) => {
    const kind = c.req.param('kind').replace('.csv', '')
    const sql: Record<string, string> = {
      needs: `${needQuery} ORDER BY n.id`,
      offers: 'SELECT o.id, o.need_id, n.title, o.store_label, o.seller, o.source, o.status, o.url, o.external_id, o.created_at FROM offers o JOIN needs n ON n.id = o.need_id ORDER BY o.id',
      observations:
        'SELECT ob.*, o.store_label, n.title FROM observations ob JOIN offers o ON o.id = ob.offer_id JOIN needs n ON n.id = o.need_id ORDER BY ob.observed_at',
      purchases: 'SELECT p.*, n.title FROM purchases p JOIN needs n ON n.id = p.need_id ORDER BY p.purchased_at',
    }
    const rows = db.prepare(sql[kind]).all() as Record<string, unknown>[]
    c.header('content-type', 'text/csv; charset=utf-8')
    c.header('content-disposition', `attachment; filename="casa-nova-${kind}.csv"`)
    return c.body('\ufeff' + toCsv(rows))
  })

  app.post('/api/backups', (c) => {
    if (!deps.backupDir) throw bad('Diretório de backup não configurado')
    const file = snapshot(db, deps.backupDir, 'manual')
    return c.json({ ok: true, file: file.split('/').pop() })
  })
  app.get('/api/backups', (c) => {
    if (!deps.backupDir || !fs.existsSync(deps.backupDir)) return c.json([])
    return c.json(
      fs
        .readdirSync(deps.backupDir)
        .filter((f) => f.endsWith('.db'))
        .sort()
        .reverse()
        .map((f) => ({ file: f, size: fs.statSync(`${deps.backupDir}/${f}`).size })),
    )
  })

  app.get('/api/collection-log', (c) =>
    c.json(
      db
        .prepare(
          `SELECT l.*, o.store_label, n.title FROM fetch_log l LEFT JOIN offers o ON o.id = l.offer_id LEFT JOIN needs n ON n.id = o.need_id
           ORDER BY l.at DESC LIMIT 100`,
        )
        .all(),
    ),
  )

  app.all('/api/*', (c) => c.json({ error: 'Rota não encontrada' }, 404))
  return app
}
