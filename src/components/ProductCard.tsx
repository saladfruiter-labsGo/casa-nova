import { Link, useLocation } from 'react-router-dom'
import { CalendarDays, Target } from 'lucide-react'
import type { NeedSummary } from '../lib/api'
import { brl, dateBR, PRIORITY_LABEL, variantLine } from '../lib/format'
import { Badge, MonitorBadge, NeedStatusBadge, ProductThumb } from './ui'

/** Preço principal do card: pago (se comprado), melhor oferta válida, última cotação ou "sem cotação" — nunca zero. */
export function PriceLine({ n }: { n: NeedSummary }) {
  if (n.status === 'comprado' || n.status === 'entregue') {
    return (
      <div className="min-w-0">
        <span className="text-lg font-semibold tabular-nums">{brl(n.spent_cents)}</span>
        <span className="muted ml-1.5 text-xs">pago, com frete</span>
      </div>
    )
  }
  if (n.best) {
    return (
      <div className="min-w-0">
        <span className={`text-lg font-semibold tabular-nums ${n.at_target ? 'text-brand-700 dark:text-brand-400' : ''}`}>{brl(n.best.value_cents)}</span>
        <span className="muted ml-1.5 text-xs">
          {n.price_basis === 'cash' ? 'à vista' : 'parcelado'}
          {n.target_mode === 'total' ? ' + frete' : ''} · <span className="whitespace-nowrap">{n.best.store_label}</span>
        </span>
      </div>
    )
  }
  if (n.last_quote) {
    return (
      <div className="min-w-0">
        <span className="text-lg font-semibold tabular-nums text-stone-500">{brl(n.last_quote.value_cents)}</span>
        <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-400">última cotação (antiga ou sem estoque)</span>
      </div>
    )
  }
  return (
    <div className="text-sm font-medium text-stone-500">
      Sem cotação <span className="muted text-xs font-normal">· {n.offers_count ? 'aguardando preço' : 'adicione uma oferta'}</span>
    </div>
  )
}

const ISSUE = new Set(['atrasado', 'requer_intervencao', 'indisponivel'])

export function ProductCard({ n }: { n: NeedSummary }) {
  const location = useLocation()
  const variant = variantLine(n)
  const where = [n.room_name, n.category_name].filter(Boolean).join(' · ')
  const open = n.status === 'planejado' || n.status === 'monitorando'
  return (
    <Link
      to={`/produtos/${n.id}`}
      state={{ from: location.pathname + location.search }}
      className="card group flex flex-col gap-3 p-4 transition-shadow hover:shadow-md focus-visible:ring-2"
    >
      <div className="flex gap-3">
        <ProductThumb src={n.image_url} alt="" size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className={`line-clamp-2 font-medium leading-snug group-hover:text-brand-700 dark:group-hover:text-brand-400 ${n.cancelled ? 'line-through opacity-60' : ''}`}>
            {n.title}
          </h3>
          {variant && <p className="muted mt-0.5 truncate text-xs">{variant}</p>}
          {where && <p className="muted mt-0.5 truncate text-xs">{where}</p>}
        </div>
      </div>
      <PriceLine n={n} />
      <div className="flex flex-wrap gap-1.5">
        <NeedStatusBadge status={n.status} />
        {n.at_target && (
          <Badge color="green" icon={<Target className="h-3.5 w-3.5" aria-hidden />}>
            No preço desejado
          </Badge>
        )}
        {open && ISSUE.has(n.monitor_health) && <MonitorBadge status={n.monitor_health} />}
      </div>
      <div className="muted mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-100 pt-2 text-xs dark:border-stone-800">
        <span>
          Prioridade <strong className="font-medium text-stone-700 dark:text-stone-300">{PRIORITY_LABEL[n.priority].toLowerCase()}</strong>
        </span>
        {n.target_price_cents !== null && open && (
          <span>
            Alvo <strong className="font-medium tabular-nums text-stone-700 dark:text-stone-300">{brl(n.target_price_cents)}</strong>
          </span>
        )}
        {n.quantity > 1 && (
          <span>
            {n.purchased_qty} de {n.quantity} comprados
          </span>
        )}
        {n.desired_date && open && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {dateBR(n.desired_date)}
          </span>
        )}
      </div>
    </Link>
  )
}
