import { FormEvent, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Link2, Loader2, PenLine } from 'lucide-react'
import { api, ApiError, Preview, StoreInfo } from '../lib/api'
import { brl } from '../lib/format'
import { Badge, ErrorBox, Field, ProductThumb, Toggle } from './ui'

export type OfferDraft =
  | { kind: 'preview'; preview: Preview; lockSeller: boolean; confirmed: boolean }
  | { kind: 'manual'; store: string; store_label: string; url: string }

export function draftReady(d: OfferDraft | null) {
  if (!d) return false
  if (d.kind === 'preview') return d.confirmed
  return !!d.store && (d.store !== 'outra' || !!d.store_label.trim())
}

/** Monta o corpo do POST /api/needs/:id/offers a partir do rascunho. */
export function draftBody(d: OfferDraft) {
  return d.kind === 'preview'
    ? { preview_id: d.preview.preview_id, variant_confirmed: d.confirmed, lock_seller: d.lockSeller }
    : { store: d.store, store_label: d.store === 'outra' ? d.store_label : undefined, url: d.url || undefined }
}

const AVAIL = { in_stock: 'Disponível', out_of_stock: 'Sem estoque', unknown: 'Estoque desconhecido' }

export function OfferPicker({ draft, onChange }: { draft: OfferDraft | null; onChange: (d: OfferDraft | null) => void }) {
  const [mode, setMode] = useState<'link' | 'manual'>(draft?.kind === 'manual' ? 'manual' : 'link')
  const [url, setUrl] = useState(draft?.kind === 'preview' ? draft.preview.url : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<StoreInfo[]>('/api/stores') })

  const read = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setBlocked(null)
    onChange(null)
    try {
      const p = await api<Preview>('/api/offers/preview', { method: 'POST', body: { url } })
      onChange({ kind: 'preview', preview: p, lockSeller: false, confirmed: false })
    } catch (err) {
      // loja sem leitura automática: oferece cadastro manual com o mesmo link
      const host = (() => {
        try {
          return new URL(url).hostname
        } catch {
          return ''
        }
      })()
      const store = stores.data?.find((s) => s.domains.some((d) => host === d || host.endsWith('.' + d)))
      if (err instanceof ApiError && err.status === 422 && store) {
        setBlocked(store.label)
        setMode('manual')
        onChange({ kind: 'manual', store: store.key, store_label: '', url })
      } else setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['link', <Link2 className="h-4 w-4" aria-hidden />, 'Colar link da loja'],
            ['manual', <PenLine className="h-4 w-4" aria-hidden />, 'Informar preço manualmente'],
          ] as const
        ).map(([m, icon, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m)
              onChange(m === 'manual' ? { kind: 'manual', store: '', store_label: '', url: '' } : null)
              setBlocked(null)
            }}
            className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors ${
              mode === m
                ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
                : 'border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {mode === 'link' && (
        <form onSubmit={read} className="space-y-3">
          <Field label="Link do produto" hint="Leroy Merlin, Carrefour e Fast Shop têm leitura automática; Amazon é parcial. Outras lojas: preço manual.">
            {(id) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id={id} className="input" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
                <button className="btn-primary shrink-0" disabled={busy || !url.trim()}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {busy ? 'Lendo…' : 'Ler produto'}
                </button>
              </div>
            )}
          </Field>
          <ErrorBox error={error} />
        </form>
      )}

      {draft?.kind === 'preview' && <PreviewCard draft={draft} onChange={onChange} />}

      {mode === 'manual' && draft?.kind === 'manual' && (
        <div className="space-y-3">
          {blocked && (
            <div role="status" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {blocked} não permite leitura automática. A oferta fica salva com o link e você informa o preço quando conferir no site.
              </span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loja">
              {(id) => (
                <select id={id} className="input" value={draft.store} onChange={(e) => onChange({ ...draft, store: e.target.value })} required>
                  <option value="">Escolha a loja</option>
                  {stores.data?.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                  <option value="outra">Outra loja</option>
                </select>
              )}
            </Field>
            {draft.store === 'outra' && (
              <Field label="Nome da loja">{(id) => <input id={id} className="input" value={draft.store_label} onChange={(e) => onChange({ ...draft, store_label: e.target.value })} required />}</Field>
            )}
          </div>
          <Field label="Link (opcional)">
            {(id) => <input id={id} className="input" type="url" inputMode="url" placeholder="https://…" value={draft.url} onChange={(e) => onChange({ ...draft, url: e.target.value })} />}
          </Field>
        </div>
      )}
    </div>
  )
}

function PreviewCard({ draft, onChange }: { draft: Extract<OfferDraft, { kind: 'preview' }>; onChange: (d: OfferDraft) => void }) {
  const p = draft.preview
  const c = p.chosen
  return (
    <div className="rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
      <div className="flex gap-3">
        <ProductThumb src={p.image_url} alt={p.title ?? ''} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{p.store.label}</span>
            {p.store.status === 'parcial' && (
              <Badge color="amber" title={p.store.note}>
                leitura parcial
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm leading-snug">{p.title ?? 'Produto sem nome'}</p>
          <p className="muted mt-1 text-xs">
            {[p.brand, p.external_id && `código ${p.external_id}`, p.ean && `EAN ${p.ean}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/50 sm:grid-cols-4">
        <div>
          <dt className="muted text-xs">À vista</dt>
          <dd className="font-semibold tabular-nums">{brl(c?.priceCashCents)}</dd>
        </div>
        <div>
          <dt className="muted text-xs">Parcelado</dt>
          <dd className="tabular-nums">{c?.priceInstallmentTotalCents ? `${brl(c.priceInstallmentTotalCents)} em ${c.installments}x` : '—'}</dd>
        </div>
        <div>
          <dt className="muted text-xs">Estoque</dt>
          <dd>{c ? AVAIL[c.availability] : '—'}</dd>
        </div>
        <div>
          <dt className="muted text-xs">Vendedor</dt>
          <dd className="truncate">{c?.seller ?? 'não informado'}</dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="muted text-xs">Frete</dt>
          <dd>Desconhecido — a loja não informa sem o carrinho. Você pode informar depois.</dd>
        </div>
      </dl>
      {p.sellers.length > 1 && (
        <p className="muted mt-2 text-xs">
          {p.sellers.length} vendedores nesta página. Mostrando o menor preço disponível.
        </p>
      )}
      <div className="mt-4 space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={draft.confirmed} onChange={(e) => onChange({ ...draft, confirmed: e.target.checked })} />
          <span className="text-sm">
            <strong className="font-medium">É exatamente este produto e variante</strong>
            <span className="muted block text-xs">Confira voltagem, cor, tamanho e modelo. Só assim o preço é comparável e o monitoramento começa.</span>
          </span>
        </label>
        {c?.seller && (
          <Toggle
            checked={draft.lockSeller}
            onChange={(x) => onChange({ ...draft, lockSeller: x })}
            label={`Acompanhar só o vendedor “${c.seller}”`}
            description="Evita que a troca de vendedor pareça desconto."
          />
        )}
        {draft.confirmed && (
          <p className="flex items-center gap-1.5 text-sm text-brand-700 dark:text-brand-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Pronto para acompanhar
          </p>
        )}
      </div>
    </div>
  )
}
