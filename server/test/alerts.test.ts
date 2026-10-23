import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlertStateRow, DEFAULT_ALERT_CONFIG, NeedContext, NeedRow, ObservationRow, OfferRow, evaluateNeed } from '../alerts.ts'

const T0 = new Date('2026-11-01T12:00:00Z')
const h = (n: number) => new Date(T0.getTime() + n * 3600_000)

const need = (o: Partial<NeedRow> = {}): NeedRow => ({
  id: 1,
  title: 'Geladeira',
  quantity: 1,
  brand: 'Brastemp',
  model: 'BRE57',
  voltage: '220V',
  color: null,
  target_price_cents: 300000,
  target_mode: 'item',
  price_basis: 'cash',
  accept_conditional: 0,
  alert_drop_pct: null,
  alert_restock: 0,
  monitoring_paused: 0,
  cancelled: 0,
  priority: 2,
  ...o,
})
const offer = (id = 10, o: Partial<OfferRow> = {}): OfferRow => ({
  id,
  need_id: 1,
  store: 'fastshop',
  store_label: 'Fast Shop',
  url: 'https://site.fastshop.com.br/x/p',
  seller: null,
  source: 'auto',
  status: 'active',
  shipping_cents_manual: null,
  ...o,
})
let obsId = 100
const obs = (at: Date, o: Partial<ObservationRow> = {}): ObservationRow => ({
  id: obsId++,
  offer_id: 10,
  observed_at: at.toISOString(),
  source: 'auto',
  price_cash_cents: 310000,
  price_installment_total_cents: null,
  installments: null,
  shipping_cents: null,
  shipping_known: 0,
  availability: 'in_stock',
  seller: 'Fast Shop',
  conditional: 0,
  conditional_note: null,
  ...o,
})
const ctx = (n: NeedRow, offers: { offer: OfferRow; observations: ObservationRow[] }[], remainingQty = n.quantity): NeedContext => ({
  need: n,
  remainingQty,
  offers,
})

/** Simula rodadas sucessivas mantendo estado (como o banco faria). */
function run(c: NeedContext, now: Date, states = new Map<string, AlertStateRow>()) {
  const r = evaluateNeed(c, states, now, DEFAULT_ALERT_CONFIG)
  for (const s of r.states) states.set(s.key, s)
  return { events: r.events, states }
}

test('preço-alvo atingido dispara uma vez na entrada da condição', () => {
  const o = obs(T0, { price_cash_cents: 290000 })
  const c = ctx(need(), [{ offer: offer(), observations: [o] }])
  const r1 = run(c, T0)
  assert.equal(r1.events.length, 1)
  assert.equal(r1.events[0].kind, 'target')
  assert.match(r1.events[0].body, /Frete: desconhecido/)
  // mesma condição na próxima coleta: sem novo alerta
  c.offers[0].observations.push(obs(h(6), { price_cash_cents: 290000 }))
  assert.equal(run(c, h(6), r1.states).events.length, 0)
})

test('oferta arquivada não participa da comparação', () => {
  const c = ctx(need(), [{ offer: offer(10, { status: 'archived' }), observations: [obs(T0, { price_cash_cents: 100 })] }])
  assert.equal(run(c, T0).events.length, 0)
})

test('Pix x parcelado: séries não se confundem', () => {
  // alvo na série parcelada; só existe preço à vista abaixo do alvo → não dispara
  const n = need({ price_basis: 'installment' })
  const c = ctx(n, [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 250000, price_installment_total_cents: 320000, installments: 10 })] }])
  assert.equal(run(c, T0).events.length, 0)
  // série à vista: dispara
  const c2 = ctx(need(), [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 250000, price_installment_total_cents: 320000, installments: 10 })] }])
  assert.equal(run(c2, T0).events.length, 1)
})

test('frete desconhecido: alerta de custo final não dispara', () => {
  const n = need({ target_mode: 'total' })
  const c = ctx(n, [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 200000 })] }])
  assert.equal(run(c, T0).events.length, 0)
  // com frete informado pelo usuário na oferta, dispara e explica
  const c2 = ctx(n, [{ offer: offer(10, { shipping_cents_manual: 5000 }), observations: [obs(T0, { price_cash_cents: 200000 })] }])
  const r = run(c2, T0)
  assert.equal(r.events.length, 1)
  assert.match(r.events[0].body, /informado por você/)
})

test('oferta indisponível não gera alerta só por atingir o preço', () => {
  const c = ctx(need(), [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 100000, availability: 'out_of_stock' })] }])
  assert.equal(run(c, T0).events.length, 0)
})

test('leitura antiga (coleta falhando) não dispara alerta', () => {
  const c = ctx(need(), [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 100000 })] }])
  assert.equal(run(c, h(30)).events.length, 0)
})

test('entrada, saída e reentrada: comportamento determinístico com cooldown de 24h', () => {
  const c = ctx(need(), [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 290000 })] }])
  const r1 = run(c, T0)
  assert.equal(r1.events.length, 1)
  c.offers[0].observations.push(obs(h(6), { price_cash_cents: 320000 })) // sai
  assert.equal(run(c, h(6), r1.states).events.length, 0)
  c.offers[0].observations.push(obs(h(12), { price_cash_cents: 290000 })) // reentra dentro do cooldown
  assert.equal(run(c, h(12), r1.states).events.length, 0)
  c.offers[0].observations.push(obs(h(18), { price_cash_cents: 320000 })) // sai
  run(c, h(18), r1.states)
  c.offers[0].observations.push(obs(h(30), { price_cash_cents: 295000 })) // reentra após cooldown
  assert.equal(run(c, h(30), r1.states).events.length, 1)
})

test('nova queda relevante reenvia (após cooldown) enquanto a condição continua', () => {
  const c = ctx(need(), [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 290000 })] }])
  const r = run(c, T0)
  c.offers[0].observations.push(obs(h(6), { price_cash_cents: 270000 })) // caiu ~7% mas dentro do cooldown
  assert.equal(run(c, h(6), r.states).events.length, 0)
  c.offers[0].observations.push(obs(h(25), { price_cash_cents: 270000 }))
  const r3 = run(c, h(25), r.states)
  assert.equal(r3.events.length, 1)
  assert.equal(r3.events[0].kind, 'target_new_low')
  c.offers[0].observations.push(obs(h(50), { price_cash_cents: 268000 })) // queda irrelevante (<5%)
  assert.equal(run(c, h(50), r.states).events.length, 0)
})

test('cupom/clube não aceito: oferta excluída', () => {
  const c = ctx(need(), [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 200000, conditional: 1, conditional_note: 'Clube' })] }])
  assert.equal(run(c, T0).events.length, 0)
  const c2 = ctx(need({ accept_conditional: 1 }), [
    { offer: offer(), observations: [obs(T0, { price_cash_cents: 200000, conditional: 1, conditional_note: 'Clube' })] },
  ])
  assert.equal(run(c2, T0).events.length, 1)
})

test('compra concluída (saldo 0) pausa alertas; compra parcial mantém', () => {
  const n = need({ quantity: 2 })
  const offers = [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 200000 })] }]
  assert.equal(run(ctx(n, offers, 0), T0).events.length, 0)
  const r = run(ctx(n, offers, 1), T0)
  assert.equal(r.events.length, 1)
  assert.match(r.events[0].body, /faltam 1 un\./)
})

test('queda percentual usa média explícita da mesma oferta e vendedor, não o "De" da loja', () => {
  const n = need({ target_price_cents: null, alert_drop_pct: 10 })
  const hist = [obs(h(-48), { price_cash_cents: 400000 }), obs(h(-24), { price_cash_cents: 400000 })]
  // troca de vendedor com preço menor não gera queda artificial
  const c = ctx(n, [{ offer: offer(), observations: [...hist, obs(T0, { price_cash_cents: 300000, seller: 'Outro vendedor' })] }])
  assert.equal(run(c, T0).events.length, 0)
  const c2 = ctx(n, [{ offer: offer(), observations: [...hist, obs(T0, { price_cash_cents: 350000 })] }])
  const r = run(c2, T0)
  assert.equal(r.events.length, 1)
  assert.match(r.events[0].body, /média de R\$ 4\.000,00 \(2 leitura/)
})

test('volta ao estoque: só após leitura indisponível; primeira leitura não dispara', () => {
  const n = need({ target_price_cents: null, alert_restock: 1 })
  const c = ctx(n, [{ offer: offer(), observations: [obs(T0, { price_cash_cents: 300000 })] }])
  const r = run(c, T0)
  assert.equal(r.events.length, 0)
  c.offers[0].observations.push(obs(h(6), { price_cash_cents: null, availability: 'out_of_stock' }))
  assert.equal(run(c, h(6), r.states).events.length, 0)
  c.offers[0].observations.push(obs(h(12), { price_cash_cents: 300000 }))
  const r3 = run(c, h(12), r.states)
  assert.equal(r3.events.length, 1)
  assert.equal(r3.events[0].kind, 'restock')
})

test('reexecução com a mesma observação gera a mesma chave de deduplicação', () => {
  const o = obs(T0, { price_cash_cents: 290000 })
  const c = ctx(need(), [{ offer: offer(), observations: [o] }])
  const a = evaluateNeed(c, new Map(), T0).events[0]
  const b = evaluateNeed(c, new Map(), T0).events[0]
  assert.equal(a.dedupeKey, b.dedupeKey)
})

test('melhor oferta entre lojas: escolhe a menor comparável', () => {
  const c = ctx(need(), [
    { offer: offer(10), observations: [obs(T0, { price_cash_cents: 295000 })] },
    { offer: offer(11, { store: 'leroymerlin', store_label: 'Leroy Merlin' }), observations: [obs(T0, { offer_id: 11, price_cash_cents: 280000 })] },
  ])
  const r = run(c, T0)
  assert.equal(r.events[0].offerId, 11)
})
