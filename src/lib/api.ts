export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique a rede e tente de novo.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.status === 401 && path !== '/api/auth/login') {
    window.dispatchEvent(new Event('cn:unauthorized'))
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Erro ${res.status}`)
  return data as T
}

// ------------------------------------------------------------------ tipos

export type NeedStatus = 'planejado' | 'monitorando' | 'comprado' | 'entregue' | 'cancelado'
export type MonitorStatus = 'manual' | 'ativo' | 'atrasado' | 'indisponivel' | 'requer_intervencao' | 'pausado' | 'aguardando' | 'sem_ofertas'

export interface Room {
  id: number
  name: string
  budget_cents: number | null
}
export interface Category {
  id: number
  name: string
}

export interface NeedSummary {
  id: number
  title: string
  room_id: number | null
  room_name: string | null
  category_id: number | null
  category_name: string | null
  quantity: number
  priority: 1 | 2 | 3
  desired_date: string | null
  budget_cents: number | null
  notes: string | null
  brand: string | null
  model: string | null
  ean: string | null
  voltage: string | null
  color: string | null
  dimensions: string | null
  variant_notes: string | null
  image_url: string | null
  target_price_cents: number | null
  target_mode: 'item' | 'total'
  price_basis: 'cash' | 'installment'
  accept_conditional: number
  alert_drop_pct: number | null
  alert_restock: number
  monitoring_paused: number
  cancelled: number
  status: NeedStatus
  purchased_qty: number
  delivered_qty: number
  remaining_qty: number
  spent_cents: number
  offers_count: number
  monitor_health: MonitorStatus
  best: {
    value_cents: number
    offer_id: number
    store_label: string
    seller: string | null
    observed_at: string
    installments: number | null
    conditional: boolean
  } | null
  last_quote: { value_cents: number; store_label: string; observed_at: string } | null
  at_target: boolean
}

export interface Observation {
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
  cep: string | null
  note: string | null
}

export interface Offer {
  id: number
  store: string
  store_label: string | null
  url: string | null
  seller: string | null
  title: string | null
  external_id: string | null
  source: 'auto' | 'manual'
  monitoring: number
  status: string
  shipping_cents_manual: number | null
  last_checked_at: string | null
  last_valid_at: string | null
  last_error: string | null
  next_check_at: string | null
  monitor_status: MonitorStatus
  latest: Observation | null
  observations: Observation[]
}

export interface Purchase {
  id: number
  need_id: number
  offer_id: number | null
  store_label: string | null
  quantity: number
  unit_price_cents: number
  shipping_cents: number
  purchased_at: string
  delivered_at: string | null
  notes: string | null
  title?: string
  room_name?: string | null
}

export interface AlertItem {
  id: number
  need_id: number | null
  need_title: string | null
  offer_id: number | null
  kind: string
  title: string
  body: string
  url: string | null
  created_at: string
  read_at: string | null
  telegram_status: 'pending' | 'sent' | 'failed' | null
}

export interface NeedDetail extends NeedSummary {
  offers: Offer[]
  purchases: Purchase[]
  alerts: AlertItem[]
  interval_hours: number
}

export interface StoreInfo {
  key: string
  label: string
  domains: string[]
  adapter: string | null
  status: 'viavel' | 'parcial' | 'indisponivel' | 'pendente'
  note: string
}

export interface SellerOffer {
  seller: string | null
  priceCashCents: number | null
  priceInstallmentTotalCents: number | null
  installments: number | null
  availability: 'in_stock' | 'out_of_stock' | 'unknown'
}

export interface Preview {
  preview_id: string
  url: string
  store: { key: string; label: string; status: string; note: string }
  title: string | null
  image_url: string | null
  external_id: string | null
  ean: string | null
  brand: string | null
  chosen: SellerOffer | null
  sellers: SellerOffer[]
}
