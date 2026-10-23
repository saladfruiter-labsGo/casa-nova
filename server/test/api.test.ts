import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../app.ts'
import { openDb, SCHEMA_VERSION, DB, snapshot } from '../db.ts'
import { hashPassword } from '../auth.ts'
import { FetchResult, Fetcher } from '../fetcher.ts'
import { collectOffer } from '../core.ts'
import { dueOffers } from '../worker.ts'
import { processOutbox, TelegramApi } from '../notify.ts'

const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const PASS = 'senha-de-teste-123'
const HASH = hashPassword(PASS)

// fetcher falso: respostas por URL, mutáveis durante o teste
let routes: Record<string, () => FetchResult>
const fakeFetcher: Fetcher = async (url) => {
  const key = Object.keys(routes).find((k) => url.toString().startsWith(k))
  if (!key) return { status: 404, url: url.toString(), text: '' }
  return routes[key]()
}
const LEROY = 'https://www.leroymerlin.com.br/luminaria-led'
const FAST = 'https://site.fastshop.com.br/tampa-microondas-natural---ou-87303/p'

let sent: string[]
const fakeTelegram: TelegramApi = async (method, body) => {
  if (method === 'sendMessage') {
    sent.push(String(body.text))
    return { ok: true }
  }
  return { ok: true, result: [] }
}

let db: DB
let app: ReturnType<typeof createApp>
let cookie = ''

async function call(method: string, p: string, body?: unknown) {
  const res = await app.request(p, {
    method,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), host: 'localhost' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  const text = await res.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {
    /* csv */
  }
  return { status: res.status, data }
}

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123:abc'
  process.env.TELEGRAM_CHAT_ID = '42'
  sent = []
  routes = {
    [LEROY]: () => ({ status: 200, url: LEROY, text: fx('leroy-instock.html') }),
    'https://site.fastshop.com.br/api/catalog_system': () => ({ status: 200, url: FAST, text: fx('fastshop-vtex.json') }),
  }
  db = openDb(':memory:')
  app = createApp({ db, fetcher: fakeFetcher, passwordHash: HASH, version: 'test', telegram: fakeTelegram })
  cookie = ''
  const r = await call('POST', '/api/auth/login', { password: PASS })
  assert.equal(r.status, 200)
})

test('acesso não autorizado é bloqueado, inclusive configuração do Telegram', async () => {
  cookie = ''
  assert.equal((await call('GET', '/api/needs')).status, 401)
  assert.equal((await call('POST', '/api/telegram/link-code', {})).status, 401)
  assert.equal((await call('POST', '/api/auth/login', { password: 'errada' })).status, 401)
  assert.equal((await call('GET', '/api/health')).status, 200)
})

test('mutação de outra origem é recusada (CSRF)', async () => {
  const res = await app.request('/api/rooms', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', host: 'localhost', origin: 'https://evil.example' },
    body: JSON.stringify({ name: 'X' }),
  })
  assert.equal(res.status, 403)
})

test('fluxo completo: cadastrar, vincular oferta real, coletar, alertar, comprar parcial e entregar', async () => {
  const room = (await call('POST', '/api/rooms', { name: 'Sala', budget_cents: 'R$ 2.000,00' })).data
  const cat = (await call('POST', '/api/categories', { name: 'Iluminação' })).data
  const need = (
    await call('POST', '/api/needs', {
      title: 'Luminária de trilho',
      room_id: room.id,
      category_id: cat.id,
      quantity: 2,
      priority: 1,
      target_price_cents: '140,00',
      voltage: 'Bivolt',
    })
  ).data
  // prévia e confirmação da variante
  const pv = await call('POST', '/api/offers/preview', { url: LEROY })
  assert.equal(pv.status, 200)
  assert.equal(pv.data.chosen.priceCashCents, 13300)
  const noConfirm = await call('POST', `/api/needs/${need.id}/offers`, { preview_id: pv.data.preview_id })
  assert.equal(noConfirm.status, 422)
  const of = await call('POST', `/api/needs/${need.id}/offers`, { preview_id: pv.data.preview_id, variant_confirmed: true })
  assert.equal(of.status, 201)

  // alvo atingido na primeira leitura → alerta + outbox
  let alerts = (await call('GET', '/api/alerts')).data
  assert.equal(alerts.length, 1)
  assert.match(alerts[0].title, /Preço desejado atingido/)
  await processOutbox(db, fakeTelegram)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /R\$ 133,00/)
  assert.match(sent[0], /Frete: desconhecido/)

  // job reexecutado / nova coleta com mesmo preço → sem segunda notificação
  db.prepare("UPDATE offers SET next_check_at = '2000-01-01T00:00:00Z'").run()
  assert.deepEqual(dueOffers(db, new Date()), [of.data.id])
  await collectOffer(db, of.data.id, { fetcher: fakeFetcher })
  await processOutbox(db, fakeTelegram)
  await processOutbox(db, fakeTelegram)
  assert.equal(sent.length, 1)

  // compra parcial: saldo continua pendente e monitorando
  await call('POST', `/api/needs/${need.id}/purchases`, { quantity: 1, unit_price_cents: '133,00', offer_id: of.data.id })
  let detail = (await call('GET', `/api/needs/${need.id}`)).data
  assert.equal(detail.remaining_qty, 1)
  assert.equal(detail.status, 'monitorando')
  assert.equal(detail.offers[0].observations.length, 2)

  // compra concluída pausa monitoramento sem apagar histórico
  const p2 = (await call('POST', `/api/needs/${need.id}/purchases`, { quantity: 1, unit_price_cents: '130,00' })).data
  detail = (await call('GET', `/api/needs/${need.id}`)).data
  assert.equal(detail.status, 'comprado')
  assert.equal(detail.offers[0].observations.length, 2)
  assert.deepEqual(dueOffers(db, new Date('2100-01-01')), [])

  // entrega
  for (const p of detail.purchases) await call('PATCH', `/api/purchases/${p.id}`, { delivered_at: '2026-11-10' })
  detail = (await call('GET', `/api/needs/${need.id}`)).data
  assert.equal(detail.status, 'entregue')
  assert.equal(detail.spent_cents, 26300)
  assert.ok(p2.id)

  // painel separa gasto realizado de estimativa
  const dash = (await call('GET', '/api/dashboard')).data
  assert.equal(dash.totals.spent_cents, 26300)
  assert.equal(dash.totals.estimate_remaining_cents, 0)

  // exportação CSV
  const csv = await call('GET', '/api/export/purchases.csv')
  assert.equal(csv.status, 200)
  assert.match(csv.data, /unit_price_cents/)
})

test('coleta com erro/CAPTCHA preserva histórico válido e marca como atrasado/intervenção', async () => {
  const need = (await call('POST', '/api/needs', { title: 'Luminária' })).data
  const pv = await call('POST', '/api/offers/preview', { url: LEROY })
  const of = (await call('POST', `/api/needs/${need.id}/offers`, { preview_id: pv.data.preview_id, variant_confirmed: true })).data
  routes[LEROY] = () => ({ status: 403, url: LEROY, text: 'blocked' })
  for (let i = 0; i < 3; i++) await collectOffer(db, of.id, { fetcher: fakeFetcher })
  const d = (await call('GET', `/api/needs/${need.id}`)).data
  assert.equal(d.offers[0].observations.length, 1, 'falha não cria observação')
  assert.equal(d.offers[0].latest.price_cash_cents, 13300, 'última leitura válida preservada')
  assert.equal(d.offers[0].monitor_status, 'requer_intervencao')
  const log = (await call('GET', '/api/collection-log')).data
  assert.equal(log.filter((l: any) => !l.ok).length, 3)
})

test('troca de variante na loja: leitura rejeitada para comparação', async () => {
  const need = (await call('POST', '/api/needs', { title: 'Tampa' })).data
  const pv = await call('POST', '/api/offers/preview', { url: FAST })
  assert.equal(pv.data.external_id, '91487')
  const of = (await call('POST', `/api/needs/${need.id}/offers`, { preview_id: pv.data.preview_id, variant_confirmed: true })).data
  const changed = JSON.parse(fx('fastshop-vtex.json'))
  changed[0].items[0].itemId = '55555'
  routes['https://site.fastshop.com.br/api/catalog_system'] = () => ({ status: 200, url: FAST, text: JSON.stringify(changed) })
  const r = await collectOffer(db, of.id, { fetcher: fakeFetcher })
  assert.equal(r.ok, false)
  const d = (await call('GET', `/api/needs/${need.id}`)).data
  assert.equal(d.offers[0].observations.length, 1)
  assert.equal(d.offers[0].monitor_status, 'requer_intervencao')
})

test('loja bloqueada: prévia explica e oferece manual; produto sem cotação não vira custo zero', async () => {
  const pv = await call('POST', '/api/offers/preview', { url: 'https://www.casasbahia.com.br/x/p/55065164' })
  assert.equal(pv.status, 422)
  assert.match(pv.data.error, /manual/)
  const need = (await call('POST', '/api/needs', { title: 'Sofá', quantity: 1 })).data
  let dash = (await call('GET', '/api/dashboard')).data
  assert.equal(dash.totals.pending_quote, 1)
  assert.equal(dash.totals.estimate_remaining_cents, 0)
  const of = (await call('POST', `/api/needs/${need.id}/offers`, { store: 'casasbahia', url: 'https://www.casasbahia.com.br/x/p/55065164' })).data
  const bad = await call('POST', `/api/offers/${of.id}/observations`, { availability: 'in_stock' })
  assert.equal(bad.status, 400)
  await call('POST', `/api/offers/${of.id}/observations`, { price_cash_cents: '1.999,90', shipping_known: true, shipping_cents: '0' })
  dash = (await call('GET', '/api/dashboard')).data
  assert.equal(dash.totals.pending_quote, 0)
  assert.equal(dash.totals.estimate_remaining_cents, 199990)
  // monitoramento automático não pode ser ligado sem leitura automática válida
  assert.equal((await call('PATCH', `/api/offers/${of.id}`, { monitoring: true })).status, 400)
})

test('URL maliciosa na prévia é recusada', async () => {
  for (const url of ['http://169.254.169.254/latest', 'https://evil.example.com/p', 'https://10.0.0.1/']) {
    const r = await call('POST', '/api/offers/preview', { url })
    assert.equal(r.status, 400, url)
  }
})

test('Telegram: falha de envio tenta de novo sem duplicar e sem vazar token', async () => {
  let attempts = 0
  const flaky: TelegramApi = async () => {
    attempts++
    return attempts === 1 ? { ok: false, description: 'falhou bot123:SECRET_TOKEN' } : { ok: true }
  }
  db.prepare(
    "INSERT INTO outbox(dedupe_key, channel, payload, next_attempt_at, created_at) VALUES ('k1','telegram','{\"text\":\"oi\"}','2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')",
  ).run()
  await processOutbox(db, flaky)
  const row = db.prepare("SELECT * FROM outbox WHERE dedupe_key='k1'").get() as any
  assert.equal(row.status, 'pending')
  assert.doesNotMatch(row.last_error, /SECRET_TOKEN/)
  await processOutbox(db, flaky, new Date(Date.now() + 3600_000))
  await processOutbox(db, flaky, new Date(Date.now() + 7200_000))
  assert.equal(attempts, 2)
  assert.equal((db.prepare("SELECT status FROM outbox WHERE dedupe_key='k1'").get() as any).status, 'sent')
})

test('migração: banco mais novo que o app é recusado; backup verificado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-'))
  const file = path.join(dir, 'x.db')
  const d = openDb(file)
  const b = snapshot(d, path.join(dir, 'bk'), 'teste')
  assert.ok(fs.existsSync(b))
  d.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
  d.close()
  assert.throws(() => openDb(file), /mais novo/)
  const raw = new DatabaseSync(b)
  assert.equal((raw.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION)
  raw.close()
  fs.rmSync(dir, { recursive: true })
})
