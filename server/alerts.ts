import { formatBRL } from './money.ts'

export interface NeedRow {
  id: number
  title: string
  quantity: number
  brand: string | null
  model: string | null
  voltage: string | null
  color: string | null
  target_price_cents: number | null
  target_mode: 'item' | 'total'
  price_basis: 'cash' | 'installment'
  accept_conditional: number
  alert_drop_pct: number | null
  alert_restock: number
  monitoring_paused: number
  cancelled: number
  room_id?: number | null
  category_id?: number | null
  priority: number
  desired_date?: string | null
  budget_cents?: number | null
}

export interface OfferRow {
  id: number
  need_id: number
  store: string
  store_label: string | null
  url: string | null
  seller: string | null
  source: 'auto' | 'manual'
  status: string
  shipping_cents_manual: number | null
}

export interface ObservationRow {
  id: number
  offer_id: number
  observed_at: string
  source: 'auto' | 'manual'
  price_cash_cents: number | null
  price_installment_total_cents: number | null
  installments: number | null
  shipping_cents: number | null
  shipping_known: number
  availability: 'in_stock' | 'out_of_stock' | 'unknown'
  seller: string | null
  conditional: number
  conditional_note: string | null
}

export interface AlertStateRow {
  key: string
  active: number
  last_sent_at: string | null
  last_value_cents: number | null
}

export interface AlertConfig {
  cooldownHours: number
  redropPct: number // nova queda relevante para reenviar enquanto a condição continua ativa
  staleHoursAuto: number
  staleHoursManual: number
  dropWindowDays: number
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  cooldownHours: 24,
  redropPct: 5,
  staleHoursAuto: 24,
  staleHoursManual: 72,
  dropWindowDays: 30,
}

export interface NeedContext {
  need: NeedRow
  remainingQty: number
  offers: { offer: OfferRow; observations: ObservationRow[] }[] // observações em ordem cronológica
}

export interface AlertEvent {
  dedupeKey: string
  kind: 'target' | 'target_new_low' | 'drop' | 'restock'
  needId: number
  offerId: number
  title: string
  body: string
  url: string | null
}

const H = 3600_000

export function isFresh(obs: ObservationRow, now: Date, cfg: AlertConfig): boolean {
  const limit = obs.source === 'manual' ? cfg.staleHoursManual : cfg.staleHoursAuto
  return now.getTime() - new Date(obs.observed_at).getTime() <= limit * H
}

/**
 * Valor comparável por unidade, na série escolhida (à vista OU parcelado — nunca misturadas).
 * Retorna null quando a oferta não pode participar: indisponível, condição não aceita,
 * série ausente ou, no modo custo final, frete desconhecido.
 */
export function comparableValue(obs: ObservationRow, need: NeedRow, offer: OfferRow): number | null {
  if (obs.availability !== 'in_stock') return null
  if (obs.conditional && !need.accept_conditional) return null
  const base = need.price_basis === 'cash' ? obs.price_cash_cents : obs.price_installment_total_cents
  if (base === null || base === undefined || base <= 0) return null
  if (need.target_mode === 'total') {
    const shipping = obs.shipping_known ? obs.shipping_cents : offer.shipping_cents_manual
    if (shipping === null || shipping === undefined) return null
    return base + shipping
  }
  return base
}

export interface BestOffer {
  offer: OfferRow
  obs: ObservationRow
  value: number
}

export function bestComparable(ctx: NeedContext, now: Date, cfg: AlertConfig = DEFAULT_ALERT_CONFIG): BestOffer | null {
  let best: BestOffer | null = null
  for (const { offer, observations } of ctx.offers) {
    if (offer.status === 'archived') continue
    const obs = observations[observations.length - 1]
    if (!obs || !isFresh(obs, now, cfg)) continue
    const value = comparableValue(obs, ctx.need, offer)
    if (value === null) continue
    if (!best || value < best.value) best = { offer, obs, value }
  }
  return best
}

function describe(need: NeedRow) {
  const variant = [need.brand, need.model, need.voltage, need.color].filter(Boolean).join(' · ')
  return variant ? `${need.title} (${variant})` : need.title
}

export function describeObservation(obs: ObservationRow, need: NeedRow, offer: OfferRow): string {
  const lines: string[] = []
  const store = offer.store_label ?? offer.store
  lines.push(`Loja: ${store}${obs.seller ? ` — vendedor: ${obs.seller}` : ''}`)
  if (obs.price_cash_cents !== null) lines.push(`À vista: ${formatBRL(obs.price_cash_cents)}`)
  if (obs.price_installment_total_cents !== null)
    lines.push(`Parcelado: ${formatBRL(obs.price_installment_total_cents)}${obs.installments ? ` em ${obs.installments}x sem juros` : ''}`)
  if (obs.conditional) lines.push(`Condição: ${obs.conditional_note || 'cupom/clube necessário'}`)
  const shipping = obs.shipping_known ? obs.shipping_cents : offer.shipping_cents_manual
  lines.push(
    shipping === null || shipping === undefined
      ? 'Frete: desconhecido'
      : `Frete: ${formatBRL(shipping)}${obs.shipping_known ? '' : ' (informado por você)'}`,
  )
  lines.push(`Estoque: ${obs.availability === 'in_stock' ? 'disponível' : obs.availability === 'out_of_stock' ? 'indisponível' : 'desconhecido'}`)
  lines.push(`Lido em: ${new Date(obs.observed_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  lines.push(`Série comparada: ${need.price_basis === 'cash' ? 'à vista' : 'parcelado'}${need.target_mode === 'total' ? ' + frete' : ''}`)
  lines.push('Confira no site antes de comprar: preço e estoque podem mudar no checkout.')
  return lines.join('\n')
}

interface Transition {
  fire: boolean
  state: AlertStateRow
}

/** Disparo por borda com cooldown. Determinístico dado (estado, condição, valor, agora). */
export function edgeTransition(
  key: string,
  prev: AlertStateRow | undefined,
  cond: boolean,
  value: number | null,
  now: Date,
  cfg: AlertConfig,
  opts: { allowRedrop: boolean; initializeSilently?: boolean },
): Transition {
  const nowIso = now.toISOString()
  const cooldownOk = (s: AlertStateRow | undefined) =>
    !s?.last_sent_at || now.getTime() - new Date(s.last_sent_at).getTime() >= cfg.cooldownHours * H
  if (!prev && opts.initializeSilently) {
    return { fire: false, state: { key, active: cond ? 1 : 0, last_sent_at: null, last_value_cents: value } }
  }
  if (!cond) {
    return { fire: false, state: { key, active: 0, last_sent_at: prev?.last_sent_at ?? null, last_value_cents: prev?.last_value_cents ?? null } }
  }
  if (!prev || !prev.active) {
    // entrada na condição
    if (cooldownOk(prev)) return { fire: true, state: { key, active: 1, last_sent_at: nowIso, last_value_cents: value } }
    return { fire: false, state: { key, active: 1, last_sent_at: prev?.last_sent_at ?? null, last_value_cents: prev?.last_value_cents ?? value } }
  }
  // condição continua ativa: só reenvia após nova queda relevante e cooldown
  if (
    opts.allowRedrop &&
    value !== null &&
    prev.last_value_cents !== null &&
    value <= Math.floor(prev.last_value_cents * (1 - cfg.redropPct / 100)) &&
    cooldownOk(prev)
  ) {
    return { fire: true, state: { key, active: 1, last_sent_at: nowIso, last_value_cents: value } }
  }
  return { fire: false, state: prev }
}

export function evaluateNeed(
  ctx: NeedContext,
  states: Map<string, AlertStateRow>,
  now: Date,
  cfg: AlertConfig = DEFAULT_ALERT_CONFIG,
): { events: AlertEvent[]; states: AlertStateRow[] } {
  const { need } = ctx
  const events: AlertEvent[] = []
  const newStates: AlertStateRow[] = []
  if (need.cancelled || need.monitoring_paused || ctx.remainingQty <= 0) return { events, states: newStates }
  const name = describe(need)

  // 1) Preço-alvo (melhor oferta elegível entre todas as lojas)
  if (need.target_price_cents !== null && need.target_price_cents > 0) {
    const key = `target:${need.id}`
    const best = bestComparable(ctx, now, cfg)
    const cond = !!best && best.value <= need.target_price_cents
    const prev = states.get(key)
    const t = edgeTransition(key, prev, cond, best?.value ?? null, now, cfg, { allowRedrop: true })
    newStates.push(t.state)
    if (t.fire && best) {
      const isNewLow = !!prev?.active
      events.push({
        dedupeKey: `${isNewLow ? 'target_new_low' : 'target'}:${need.id}:${best.offer.id}:${best.obs.id}`,
        kind: isNewLow ? 'target_new_low' : 'target',
        needId: need.id,
        offerId: best.offer.id,
        title: `${isNewLow ? 'Caiu mais' : 'Preço desejado atingido'}: ${name}`,
        body:
          `${formatBRL(best.value)} por unidade${need.target_mode === 'total' ? ' com frete' : ''} ` +
          `(seu alvo: ${formatBRL(need.target_price_cents)}; faltam ${ctx.remainingQty} un.)\n` +
          describeObservation(best.obs, need, best.offer),
        url: best.offer.url,
      })
    }
  }

  for (const { offer, observations } of ctx.offers) {
    if (offer.status === 'archived') continue
    const latest = observations[observations.length - 1]
    if (!latest || !isFresh(latest, now, cfg)) continue

    // 2) Queda percentual vs. média explícita da MESMA oferta e MESMO vendedor
    if (need.alert_drop_pct && need.alert_drop_pct > 0) {
      const key = `drop:${offer.id}`
      const value = comparableValue(latest, need, offer)
      const windowStart = now.getTime() - cfg.dropWindowDays * 24 * H
      const refs = observations
        .slice(0, -1)
        .filter((o) => new Date(o.observed_at).getTime() >= windowStart && (o.seller ?? '') === (latest.seller ?? ''))
        .map((o) => comparableValue(o, need, offer))
        .filter((v): v is number => v !== null)
      const ref = refs.length ? Math.round(refs.reduce((a, b) => a + b, 0) / refs.length) : null
      const cond = value !== null && ref !== null && value <= ref * (1 - need.alert_drop_pct / 100)
      const t = edgeTransition(key, states.get(key), cond, value, now, cfg, { allowRedrop: false })
      newStates.push(t.state)
      if (t.fire && value !== null && ref !== null) {
        const pct = Math.round((1 - value / ref) * 100)
        events.push({
          dedupeKey: `drop:${need.id}:${offer.id}:${latest.id}`,
          kind: 'drop',
          needId: need.id,
          offerId: offer.id,
          title: `Queda de ${pct}%: ${name}`,
          body:
            `${formatBRL(value)} contra média de ${formatBRL(ref)} (${refs.length} leitura(s) desta loja/vendedor nos últimos ${cfg.dropWindowDays} dias).\n` +
            describeObservation(latest, need, offer),
          url: offer.url,
        })
      }
    }

    // 3) Volta ao estoque (só quando havia leitura anterior indisponível)
    if (need.alert_restock) {
      const key = `restock:${offer.id}`
      const inStock = latest.availability === 'in_stock'
      const prevObs = observations[observations.length - 2]
      const prevState = states.get(key)
      const t = edgeTransition(key, prevState, inStock, latest.price_cash_cents, now, cfg, {
        allowRedrop: false,
        initializeSilently: !prevState && prevObs?.availability !== 'out_of_stock',
      })
      newStates.push(t.state)
      if (t.fire && (prevState || prevObs?.availability === 'out_of_stock')) {
        events.push({
          dedupeKey: `restock:${need.id}:${offer.id}:${latest.id}`,
          kind: 'restock',
          needId: need.id,
          offerId: offer.id,
          title: `De volta ao estoque: ${name}`,
          body: describeObservation(latest, need, offer),
          url: offer.url,
        })
      }
    }
  }
  return { events, states: newStates }
}
