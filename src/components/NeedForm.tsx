import { FormEvent, ReactNode, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { api, Category, NeedSummary, Room } from '../lib/api'
import { centsToInput, parseBRL } from '../lib/format'
import { ErrorBox, Field, MoneyInput, Segmented, Toggle, useToast } from './ui'

export interface NeedFormValues {
  title: string
  room_id: string
  category_id: string
  quantity: string
  priority: '1' | '2' | '3'
  desired_date: string
  budget: string
  notes: string
  brand: string
  model: string
  ean: string
  voltage: string
  color: string
  dimensions: string
  variant_notes: string
  target: string
  target_mode: 'item' | 'total'
  price_basis: 'cash' | 'installment'
  accept_conditional: boolean
  alert_drop_pct: string
  alert_restock: boolean
}

export function emptyNeed(over: Partial<NeedFormValues> = {}): NeedFormValues {
  return {
    title: '',
    room_id: '',
    category_id: '',
    quantity: '1',
    priority: '2',
    desired_date: '',
    budget: '',
    notes: '',
    brand: '',
    model: '',
    ean: '',
    voltage: '',
    color: '',
    dimensions: '',
    variant_notes: '',
    target: '',
    target_mode: 'item',
    price_basis: 'cash',
    accept_conditional: false,
    alert_drop_pct: '',
    alert_restock: false,
    ...over,
  }
}

export function needToForm(n: NeedSummary): NeedFormValues {
  return emptyNeed({
    title: n.title,
    room_id: n.room_id ? String(n.room_id) : '',
    category_id: n.category_id ? String(n.category_id) : '',
    quantity: String(n.quantity),
    priority: String(n.priority) as '1',
    desired_date: n.desired_date ?? '',
    budget: centsToInput(n.budget_cents),
    notes: n.notes ?? '',
    brand: n.brand ?? '',
    model: n.model ?? '',
    ean: n.ean ?? '',
    voltage: n.voltage ?? '',
    color: n.color ?? '',
    dimensions: n.dimensions ?? '',
    variant_notes: n.variant_notes ?? '',
    target: centsToInput(n.target_price_cents),
    target_mode: n.target_mode,
    price_basis: n.price_basis,
    accept_conditional: !!n.accept_conditional,
    alert_drop_pct: n.alert_drop_pct ? String(n.alert_drop_pct) : '',
    alert_restock: !!n.alert_restock,
  })
}

export function formToPayload(v: NeedFormValues) {
  const money = (s: string, label: string) => {
    if (!s.trim()) return null
    const c = parseBRL(s)
    if (c === null) throw new Error(`${label}: valor inválido. Use, por exemplo, 1.299,90`)
    return c
  }
  return {
    title: v.title.trim(),
    room_id: v.room_id ? Number(v.room_id) : null,
    category_id: v.category_id ? Number(v.category_id) : null,
    quantity: Number(v.quantity) || 1,
    priority: Number(v.priority),
    desired_date: v.desired_date || null,
    budget_cents: money(v.budget, 'Orçamento'),
    notes: v.notes,
    brand: v.brand,
    model: v.model,
    ean: v.ean,
    voltage: v.voltage,
    color: v.color,
    dimensions: v.dimensions,
    variant_notes: v.variant_notes,
    target_price_cents: money(v.target, 'Preço desejado'),
    target_mode: v.target_mode,
    price_basis: v.price_basis,
    accept_conditional: v.accept_conditional,
    alert_drop_pct: v.alert_drop_pct ? Number(v.alert_drop_pct.replace(',', '.')) : null,
    alert_restock: v.alert_restock,
  }
}

function CreatableSelect({ id, kind, value, onChange }: { id: string; kind: 'rooms' | 'categories'; value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useQuery({ queryKey: [kind], queryFn: () => api<(Room | Category)[]>(`/api/${kind}`) })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const noun = kind === 'rooms' ? 'cômodo' : 'categoria'
  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const r = await api<Room>(`/api/${kind}`, { method: 'POST', body: { name } })
      await qc.invalidateQueries({ queryKey: [kind] })
      onChange(String(r.id))
      setAdding(false)
      setName('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  if (adding)
    return (
      <div className="flex gap-2">
        <input
          id={id}
          className="input"
          autoFocus
          placeholder={kind === 'rooms' ? 'Ex.: Cozinha' : 'Ex.: Eletrodomésticos'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create()
            }
            if (e.key === 'Escape') setAdding(false)
          }}
        />
        <button type="button" className="btn-primary px-3" onClick={create} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar'}
        </button>
        <button type="button" className="btn-ghost px-3" onClick={() => setAdding(false)}>
          Cancelar
        </button>
      </div>
    )
  return (
    <div className="flex gap-2">
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sem {noun}</option>
        {data?.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn-secondary shrink-0 px-3" onClick={() => setAdding(true)} aria-label={`Novo ${noun}`} title={`Novo ${noun}`}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function Section({ title, children, desc }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {desc && <p className="muted mt-0.5 text-sm">{desc}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

export function NeedForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: NeedFormValues
  submitLabel: string
  onSubmit: (payload: ReturnType<typeof formToPayload>) => Promise<void>
  onCancel?: () => void
}) {
  const [v, setV] = useState(initial)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const hasAdvanced = !!(initial.model || initial.voltage || initial.color || initial.dimensions || initial.ean || initial.variant_notes || initial.budget || initial.notes)
  const [advanced, setAdvanced] = useState(hasAdvanced)
  const set = <K extends keyof NeedFormValues>(k: K, val: NeedFormValues[K]) => setV((s) => ({ ...s, [k]: val }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await onSubmit(formToPayload(v)) // em erro, os dados digitados continuam no formulário
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section title="O que você precisa">
        <Field label="Nome do produto">
          {(id) => <input id={id} className="input" required maxLength={200} placeholder="Ex.: Geladeira frost free" value={v.title} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cômodo">{(id) => <CreatableSelect id={id} kind="rooms" value={v.room_id} onChange={(x) => set('room_id', x)} />}</Field>
          <Field label="Categoria">{(id) => <CreatableSelect id={id} kind="categories" value={v.category_id} onChange={(x) => set('category_id', x)} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantidade">
            {(id) => <input id={id} className="input" type="number" min={1} max={999} inputMode="numeric" value={v.quantity} onChange={(e) => set('quantity', e.target.value)} />}
          </Field>
          <div>
            <span className="label" id="prio-label">
              Prioridade
            </span>
            <Segmented
              label="Prioridade"
              value={v.priority}
              onChange={(x) => set('priority', x)}
              options={[
                { value: '1', label: 'Alta' },
                { value: '2', label: 'Média' },
                { value: '3', label: 'Baixa' },
              ]}
            />
          </div>
          <Field label="Comprar até" hint="Opcional">
            {(id) => <input id={id} className="input" type="date" value={v.desired_date} onChange={(e) => set('desired_date', e.target.value)} />}
          </Field>
        </div>
        <Field label="Marca">{(id) => <input id={id} className="input" value={v.brand} onChange={(e) => set('brand', e.target.value)} />}</Field>

        <button type="button" className="btn-ghost -ml-2 text-brand-700 dark:text-brand-400" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? 'rotate-180' : ''}`} aria-hidden />
          {advanced ? 'Menos detalhes' : 'Modelo, voltagem, cor e mais detalhes'}
        </button>
        {advanced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Modelo">{(id) => <input id={id} className="input" value={v.model} onChange={(e) => set('model', e.target.value)} />}</Field>
            <Field label="Voltagem">
              {(id) => (
                <select id={id} className="input" value={v.voltage} onChange={(e) => set('voltage', e.target.value)}>
                  <option value="">Não se aplica / não sei</option>
                  <option>110V</option>
                  <option>127V</option>
                  <option>220V</option>
                  <option>Bivolt</option>
                </select>
              )}
            </Field>
            <Field label="Cor">{(id) => <input id={id} className="input" value={v.color} onChange={(e) => set('color', e.target.value)} />}</Field>
            <Field label="Dimensões">{(id) => <input id={id} className="input" placeholder="Ex.: 70 × 180 × 75 cm" value={v.dimensions} onChange={(e) => set('dimensions', e.target.value)} />}</Field>
            <Field label="Código de barras (EAN)" hint="Ajuda a confirmar que é o mesmo produto em lojas diferentes">
              {(id) => <input id={id} className="input" inputMode="numeric" value={v.ean} onChange={(e) => set('ean', e.target.value)} />}
            </Field>
            <Field label="Orçamento para este item" hint="Opcional, valor total">
              {(id) => <MoneyInput id={id} value={v.budget} onChange={(x) => set('budget', x)} />}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Outras variantes importantes">
                {(id) => <input id={id} className="input" placeholder="Ex.: porta à direita, 2 portas, inox" value={v.variant_notes} onChange={(e) => set('variant_notes', e.target.value)} />}
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Observações">{(id) => <textarea id={id} rows={3} className="input py-2" value={v.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
            </div>
          </div>
        )}
      </Section>

      <Section title="Preço desejado" desc="Avisamos quando a melhor oferta disponível ficar igual ou abaixo deste valor.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preço desejado (por unidade)" hint="Deixe em branco para só acompanhar">
            {(id) => <MoneyInput id={id} value={v.target} onChange={(x) => set('target', x)} />}
          </Field>
          <div className="space-y-3">
            <div>
              <span className="label">Comparar pelo preço</span>
              <Segmented
                label="Comparar pelo preço"
                value={v.price_basis}
                onChange={(x) => set('price_basis', x)}
                options={[
                  { value: 'cash', label: 'À vista / Pix' },
                  { value: 'installment', label: 'Total parcelado' },
                ]}
              />
            </div>
            <div>
              <span className="label">Valor considerado</span>
              <Segmented
                label="Valor considerado"
                value={v.target_mode}
                onChange={(x) => set('target_mode', x)}
                options={[
                  { value: 'item', label: 'Só o produto' },
                  { value: 'total', label: 'Produto + frete' },
                ]}
              />
              {v.target_mode === 'total' && <p className="hint">Ofertas com frete desconhecido não disparam este aviso.</p>}
            </div>
          </div>
        </div>
        <Toggle
          checked={v.accept_conditional}
          onChange={(x) => set('accept_conditional', x)}
          label="Aceito preço com cupom ou clube de assinatura"
          description="Se desligado, ofertas que dependem de cupom/clube não contam."
        />
        <Toggle checked={v.alert_restock} onChange={(x) => set('alert_restock', x)} label="Avisar quando voltar ao estoque" />
        <Field label="Avisar também se cair pelo menos (%)" hint="Compara com a média dos últimos 30 dias da mesma loja e vendedor, não com o preço “De” anunciado.">
          {(id) => (
            <div className="relative w-32">
              <input id={id} className="input pr-8" inputMode="decimal" placeholder="Ex.: 10" value={v.alert_drop_pct} onChange={(e) => set('alert_drop_pct', e.target.value.replace(/[^\d.,]/g, ''))} />
              <span className="muted pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">%</span>
            </div>
          )}
        </Field>
      </Section>

      <ErrorBox error={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn-primary" disabled={busy || !v.title.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
