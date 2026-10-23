import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Home, Plus, Target, Wallet } from 'lucide-react'
import { api, NeedSummary } from '../lib/api'
import { brl, plural } from '../lib/format'
import { EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui'
import { ProductCard } from '../components/ProductCard'

interface Group {
  items: number
  planned: number
  bought: number
  delivered: number
  spent_cents: number
  estimate_remaining_cents: number
  pending_quote: number
}
interface Dashboard {
  totals: Group & { budget_cents: number | null }
  by_room: (Group & { room_id: number | null; name: string; budget_cents: number | null })[]
  at_target: NeedSummary[]
  next: NeedSummary[]
  attention: NeedSummary[]
  unread_alerts: number
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="muted flex items-center gap-2 text-sm">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-[28px]">{value}</div>
      {sub && <div className="muted mt-1 text-xs">{sub}</div>}
    </div>
  )
}

export default function Overview() {
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/dashboard') })
  if (isLoading) return <Spinner />
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />
  const t = data.totals

  if (t.items === 0)
    return (
      <>
        <PageHeader title="Visão geral" />
        <EmptyState
          icon={<Home className="h-6 w-6" />}
          title="Comece pela sua lista da mudança"
          action={
            <Link to="/produtos/novo" className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden /> Adicionar produto
            </Link>
          }
        >
          Cole o link de um produto de uma loja ou cadastre manualmente. Você define o preço desejado e o Casa Nova avisa quando ele aparecer.
        </EmptyState>
      </>
    )

  const committed = t.spent_cents + t.estimate_remaining_cents
  const diff = t.budget_cents !== null ? t.budget_cents - committed : null

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle={`${plural(t.items, 'produto', 'produtos')} na lista · ${t.planned} a comprar · ${t.bought} a caminho · ${plural(t.delivered, 'entregue', 'entregues')}`}
        actions={
          <Link to="/produtos/novo" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> Adicionar produto
          </Link>
        }
      />

      <section aria-label="Resumo financeiro" className="grid gap-3 sm:grid-cols-3">
        <Stat label="Já gasto" value={brl(t.spent_cents)} icon={<Wallet className="h-4 w-4" aria-hidden />} sub="compras registradas, com frete" />
        <Stat
          label="Estimativa do que falta"
          value={brl(t.estimate_remaining_cents)}
          icon={<Target className="h-4 w-4" aria-hidden />}
          sub={
            t.pending_quote > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                Incompleta: {plural(t.pending_quote, 'item sem cotação não entra', 'itens sem cotação não entram')} na soma
              </span>
            ) : (
              'pelo melhor preço conhecido de cada item'
            )
          }
        />
        <Stat
          label="Orçamento"
          value={t.budget_cents !== null ? brl(t.budget_cents) : 'Não definido'}
          icon={<Home className="h-4 w-4" aria-hidden />}
          sub={
            diff === null ? (
              <Link to="/configuracoes" className="underline">
                Defina orçamentos por cômodo
              </Link>
            ) : diff >= 0 ? (
              `Sobram ${brl(diff)} considerando gasto + estimativa`
            ) : (
              <span className="text-red-700 dark:text-red-400">Passa {brl(-diff)} do orçamento (gasto + estimativa)</span>
            )
          }
        />
      </section>

      {data.at_target.length > 0 && (
        <section className="mt-8" aria-labelledby="h-target">
          <h2 id="h-target" className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Target className="h-5 w-5 text-brand-600" aria-hidden /> Atingiram o preço desejado
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.at_target.map((n) => (
              <ProductCard key={n.id} n={n} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8" aria-labelledby="h-next">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="h-next" className="text-lg font-semibold">
            Próximas compras
          </h2>
          <Link to="/produtos" className="btn-ghost -mr-2 text-sm">
            Ver todos <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {data.next.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.next.map((n) => (
              <ProductCard key={n.id} n={n} />
            ))}
          </div>
        ) : (
          <p className="muted text-sm">Nada pendente. Tudo comprado! 🎉</p>
        )}
      </section>

      {data.attention.length > 0 && (
        <section className="mt-8" aria-labelledby="h-att">
          <h2 id="h-att" className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden /> Preços que precisam de conferência
          </h2>
          <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
            {data.attention.map((n) => (
              <li key={n.id}>
                <Link to={`/produtos/${n.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50">
                  <span className="truncate">{n.title}</span>
                  <span className="muted shrink-0 text-xs">{n.monitor_health === 'requer_intervencao' ? 'Leitura falhou — confira a oferta' : 'Preço desatualizado'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="h-rooms">
        <h2 id="h-rooms" className="mb-3 text-lg font-semibold">
          Por cômodo
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.by_room.map((r) => {
            const done = r.bought + r.delivered
            const pct = r.items ? Math.round((done / r.items) * 100) : 0
            return (
              <Link
                key={r.room_id ?? 'none'}
                to={r.room_id ? `/produtos?room=${r.room_id}` : '/produtos'}
                className="card block p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium">{r.name}</h3>
                  <span className="muted text-xs">
                    {done}/{r.items} comprados
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name}: ${pct}% comprado`}>
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="muted">Gasto</dt>
                    <dd className="font-medium tabular-nums">{brl(r.spent_cents)}</dd>
                  </div>
                  <div>
                    <dt className="muted">Falta (estimado)</dt>
                    <dd className="font-medium tabular-nums">
                      {brl(r.estimate_remaining_cents)}
                      {r.pending_quote > 0 && <span className="text-amber-700 dark:text-amber-400"> + {r.pending_quote} s/ cotação</span>}
                    </dd>
                  </div>
                  {r.budget_cents !== null && (
                    <div className="col-span-2">
                      <dt className="muted">Orçamento</dt>
                      <dd className="font-medium tabular-nums">{brl(r.budget_cents)}</dd>
                    </div>
                  )}
                </dl>
              </Link>
            )
          })}
        </div>
      </section>
    </>
  )
}
