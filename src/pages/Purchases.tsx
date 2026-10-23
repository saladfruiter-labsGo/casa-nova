import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShoppingCart, Truck } from 'lucide-react'
import { api, Purchase } from '../lib/api'
import { brl, dateBR, todayISO } from '../lib/format'
import { DeliveryBadge, EmptyState, ErrorBox, PageHeader, Spinner, useToast } from '../components/ui'

export default function Purchases() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['purchases'], queryFn: () => api<Purchase[]>('/api/purchases') })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const pending = q.data.filter((p) => !p.delivered_at)
  const delivered = q.data.filter((p) => p.delivered_at)
  const total = q.data.reduce((a, p) => a + p.quantity * p.unit_price_cents + p.shipping_cents, 0)

  const markDelivered = async (p: Purchase) => {
    try {
      await api(`/api/purchases/${p.id}`, { method: 'PATCH', body: { delivered_at: todayISO() } })
      await qc.invalidateQueries()
      toast('Entrega registrada')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const List = ({ items }: { items: Purchase[] }) => (
    <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
      {items.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <Link to={`/produtos/${p.need_id}`} className="font-medium hover:underline">
              {p.title}
            </Link>
            <div className="muted text-xs">
              {[p.store_label, p.room_name, `comprado em ${dateBR(p.purchased_at)}`, p.delivered_at && `entregue em ${dateBR(p.delivered_at)}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold tabular-nums">{brl(p.quantity * p.unit_price_cents + p.shipping_cents)}</div>
            <div className="muted text-xs tabular-nums">
              {p.quantity} × {brl(p.unit_price_cents)}
              {p.shipping_cents > 0 && ` + ${brl(p.shipping_cents)}`}
            </div>
          </div>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <DeliveryBadge delivered={!!p.delivered_at} />
            {!p.delivered_at && (
              <button className="btn-secondary min-h-[34px] px-3 text-xs" onClick={() => markDelivered(p)}>
                <Truck className="h-3.5 w-3.5" aria-hidden /> Chegou
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <PageHeader title="Compras" subtitle={q.data.length ? `${q.data.length} compra(s) · ${brl(total)} gastos com frete` : undefined} />
      {q.data.length === 0 ? (
        <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title="Nenhuma compra registrada" action={<Link to="/produtos" className="btn-primary">Ver produtos</Link>}>
          Quando comprar algo, abra o produto e use “Marcar como comprado”. O preço pago entra no gasto real e o monitoramento daquele item para.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <section aria-labelledby="h-pend">
              <h2 id="h-pend" className="mb-3 text-lg font-semibold">
                Aguardando entrega ({pending.length})
              </h2>
              <List items={pending} />
            </section>
          )}
          {delivered.length > 0 && (
            <section aria-labelledby="h-del">
              <h2 id="h-del" className="mb-3 text-lg font-semibold">
                Entregues ({delivered.length})
              </h2>
              <List items={delivered} />
            </section>
          )}
        </div>
      )}
    </>
  )
}
