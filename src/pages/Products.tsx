import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, Plus, Search, X } from 'lucide-react'
import { api, Category, NeedSummary, Room } from '../lib/api'
import { plural } from '../lib/format'
import { EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui'
import { ProductCard } from '../components/ProductCard'

const STATUS = [
  { v: '', l: 'Situação' },
  { v: 'planejado', l: 'Planejados' },
  { v: 'monitorando', l: 'Monitorando' },
  { v: 'comprado', l: 'Comprados' },
  { v: 'entregue', l: 'Entregues' },
  { v: 'cancelado', l: 'Cancelados' },
]

export default function Products() {
  // filtros na URL: preservados ao abrir um produto e voltar
  const [sp, setSp] = useSearchParams()
  const f = { room: sp.get('room') ?? '', category: sp.get('category') ?? '', priority: sp.get('priority') ?? '', status: sp.get('status') ?? '', q: sp.get('q') ?? '' }
  const set = (k: keyof typeof f, v: string) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    setSp(next, { replace: true })
  }
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api<Room[]>('/api/rooms') })
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/api/categories') })
  const list = useQuery({ queryKey: ['needs', qs], queryFn: () => api<NeedSummary[]>(`/api/needs${qs ? '?' + qs : ''}`), placeholderData: (p) => p })
  const active = Object.values(f).filter(Boolean).length

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle={list.data ? plural(list.data.length, 'produto', 'produtos') : undefined}
        actions={
          <Link to="/produtos/novo" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> Adicionar produto
          </Link>
        }
      />

      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <input type="search" aria-label="Buscar produto" placeholder="Buscar por nome, marca ou modelo" className="input pl-9" value={f.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select aria-label="Cômodo" className="input sm:w-auto" value={f.room} onChange={(e) => set('room', e.target.value)}>
            <option value="">Cômodo</option>
            {rooms.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select aria-label="Categoria" className="input sm:w-auto" value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">Categoria</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="Prioridade" className="input sm:w-auto" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Prioridade</option>
            <option value="1">Alta</option>
            <option value="2">Média</option>
            <option value="3">Baixa</option>
          </select>
          <select aria-label="Situação" className="input sm:w-auto" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.l}
              </option>
            ))}
          </select>
          {active > 0 && (
            <button className="btn-ghost col-span-2 sm:col-span-1" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
              <X className="h-4 w-4" aria-hidden /> Limpar filtros
            </button>
          )}
        </div>
      </div>

      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        active ? (
          <EmptyState icon={<Search className="h-6 w-6" />} title="Nenhum produto com esses filtros" action={<button className="btn-secondary" onClick={() => setSp(new URLSearchParams())}>Limpar filtros</button>} />
        ) : (
          <EmptyState
            icon={<LayoutGrid className="h-6 w-6" />}
            title="Sua lista está vazia"
            action={
              <Link to="/produtos/novo" className="btn-primary">
                <Plus className="h-4 w-4" aria-hidden /> Adicionar o primeiro produto
              </Link>
            }
          >
            Cadastre o que você precisa comprar para a casa nova, por cômodo e categoria.
          </EmptyState>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((n) => (
            <ProductCard key={n.id} n={n} />
          ))}
        </div>
      )}
    </>
  )
}
