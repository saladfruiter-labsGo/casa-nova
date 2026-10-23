import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Archive,
  Bell,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShoppingCart,
  Tag,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react'
import { api, NeedDetail, Offer } from '../lib/api'
import { ago, brl, centsToInput, dateBR, dateTimeBR, parseBRL, PRIORITY_LABEL, todayISO, variantLine } from '../lib/format'
import { Badge, DeliveryBadge, ErrorBox, Field, Modal, MonitorBadge, MoneyInput, NeedStatusBadge, ProductThumb, Segmented, Spinner, Toggle, useToast } from '../components/ui'
import { PriceHistory } from '../components/PriceHistory'
import { OfferDraft, OfferPicker, draftBody, draftReady } from '../components/OfferPicker'

type ModalState =
  | { kind: 'offer' }
  | { kind: 'price'; offer: Offer }
  | { kind: 'shipping'; offer: Offer }
  | { kind: 'purchase' }
  | null

export default function ProductDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const loc = useLocation()
  const qc = useQueryClient()
  const toast = useToast()
  const [modal, setModal] = useState<ModalState>(null)
  const [menu, setMenu] = useState(false)
  const [checking, setChecking] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['need', id], queryFn: () => api<NeedDetail>(`/api/needs/${id}`) })
  const back = (loc.state as { from?: string } | null)?.from ?? '/produtos'
  const refresh = () => qc.invalidateQueries()

  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const n = q.data
  const variant = variantLine(n)
  const activeOffers = n.offers.filter((o) => o.status !== 'archived')
  const archived = n.offers.length - activeOffers.length

  const patchNeed = async (body: object, msg: string) => {
    try {
      await api(`/api/needs/${n.id}`, { method: 'PATCH', body })
      await refresh()
      toast(msg)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setMenu(false)
  }

  const checkNow = async (o: Offer) => {
    setChecking(o.id)
    try {
      await api(`/api/offers/${o.id}/check`, { method: 'POST', body: {} })
      toast('Preço atualizado')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChecking(null)
      await refresh()
    }
  }

  const archive = async (o: Offer) => {
    try {
      await api(`/api/offers/${o.id}`, { method: 'PATCH', body: { archived: true } })
      await refresh()
      toast('Oferta arquivada. O histórico foi mantido.')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div>
      <Link to={back} className="btn-ghost -ml-2 mb-3">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {back.startsWith('/produtos') ? 'Voltar para produtos' : 'Voltar'}
      </Link>

      {/* cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ProductThumb src={n.image_url} alt={n.title} size={n.image_url ? 'lg' : 'md'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <NeedStatusBadge status={n.status} />
            {n.monitoring_paused ? (
              <Badge icon={<Pause className="h-3.5 w-3.5" aria-hidden />}>Monitoramento pausado</Badge>
            ) : null}
            <Badge>Prioridade {PRIORITY_LABEL[n.priority].toLowerCase()}</Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{n.title}</h1>
          {variant && <p className="muted mt-1 text-sm">{variant}</p>}
          <p className="muted mt-1 text-sm">
            {[n.room_name, n.category_name].filter(Boolean).join(' · ') || 'Sem cômodo ou categoria'}
            {n.desired_date && ` · comprar até ${dateBR(n.desired_date)}`}
          </p>
          {(n.dimensions || n.variant_notes || n.ean) && (
            <p className="muted mt-1 text-xs">{[n.dimensions, n.variant_notes, n.ean && `EAN ${n.ean}`].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {n.remaining_qty > 0 && !n.cancelled && (
            <button className="btn-primary col-span-2" onClick={() => setModal({ kind: 'purchase' })}>
              <ShoppingCart className="h-4 w-4" aria-hidden /> Marcar como comprado
            </button>
          )}
          <Link to={`/produtos/${n.id}/editar`} className="btn-secondary">
            <Pencil className="h-4 w-4" aria-hidden /> Editar
          </Link>
          <div className="relative">
            <button className="btn-secondary px-3" aria-haspopup="menu" aria-expanded={menu} aria-label="Mais ações" onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menu && (
              <div role="menu" className="card absolute right-0 z-20 mt-2 w-60 p-1">
                <button role="menuitem" className="btn-ghost w-full justify-start" onClick={() => patchNeed({ monitoring_paused: !n.monitoring_paused }, n.monitoring_paused ? 'Monitoramento retomado' : 'Monitoramento pausado')}>
                  {n.monitoring_paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {n.monitoring_paused ? 'Retomar monitoramento' : 'Pausar monitoramento'}
                </button>
                <button role="menuitem" className="btn-ghost w-full justify-start" onClick={() => patchNeed({ cancelled: !n.cancelled }, n.cancelled ? 'Produto reativado' : 'Produto cancelado')}>
                  <XCircle className="h-4 w-4" />
                  {n.cancelled ? 'Reativar produto' : 'Não vou mais comprar'}
                </button>
                {n.purchases.length === 0 && (
                  <button
                    role="menuitem"
                    className="btn-danger w-full justify-start"
                    onClick={async () => {
                      if (!confirm('Excluir este produto, suas ofertas e o histórico de preços? Esta ação não pode ser desfeita.')) return
                      try {
                        await api(`/api/needs/${n.id}`, { method: 'DELETE' })
                        await refresh()
                        toast('Produto excluído')
                        nav(back)
                      } catch (e) {
                        toast((e as Error).message, 'error')
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Excluir produto
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* resumo */}
      <section aria-label="Resumo" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <div className="muted text-xs">Melhor oferta válida</div>
          {n.best ? (
            <>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${n.at_target ? 'text-brand-700 dark:text-brand-400' : ''}`}>{brl(n.best.value_cents)}</div>
              <div className="muted text-xs">
                {n.price_basis === 'cash' ? 'à vista' : 'parcelado'}
                {n.target_mode === 'total' ? ' + frete' : ''} · {n.best.store_label}
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-sm font-medium">Nenhuma no momento</div>
              <div className="muted text-xs">{n.last_quote ? `Última cotação ${brl(n.last_quote.value_cents)} (${ago(n.last_quote.observed_at)})` : 'Adicione uma oferta'}</div>
            </>
          )}
        </div>
        <div className="card p-4">
          <div className="muted text-xs">Preço desejado</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{n.target_price_cents !== null ? brl(n.target_price_cents) : '—'}</div>
          <div className="muted text-xs">
            {n.target_price_cents === null ? (
              <Link className="underline" to={`/produtos/${n.id}/editar`}>
                Definir alvo
              </Link>
            ) : n.at_target ? (
              <span className="font-medium text-brand-700 dark:text-brand-400">Atingido agora</span>
            ) : n.best ? (
              `faltam ${brl(n.best.value_cents - n.target_price_cents)}`
            ) : (
              'por unidade'
            )}
          </div>
        </div>
        <div className="card p-4">
          <div className="muted text-xs">Comprados</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {n.purchased_qty} de {n.quantity}
          </div>
          <div className="muted text-xs">{n.remaining_qty > 0 ? `${n.remaining_qty === 1 ? 'falta' : 'faltam'} ${n.remaining_qty}` : n.delivered_qty >= n.quantity ? 'tudo entregue' : 'tudo comprado'}</div>
        </div>
        <div className="card p-4">
          <div className="muted text-xs">Gasto</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{brl(n.spent_cents)}</div>
          <div className="muted text-xs">{n.budget_cents !== null ? `orçamento ${brl(n.budget_cents)}` : n.spent_cents ? 'com frete' : 'nada comprado ainda'}</div>
        </div>
      </section>

      {/* ofertas */}
      <section className="mt-8" aria-labelledby="h-offers">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="h-offers" className="text-lg font-semibold">
            Ofertas
          </h2>
          <button className="btn-secondary" onClick={() => setModal({ kind: 'offer' })}>
            <Plus className="h-4 w-4" aria-hidden /> Adicionar oferta
          </button>
        </div>
        {activeOffers.length === 0 ? (
          <div className="card p-6 text-center text-sm">
            <p className="muted">Nenhuma oferta ainda. Cole o link do produto em uma loja ou informe um preço que você viu.</p>
            <button className="btn-primary mt-4" onClick={() => setModal({ kind: 'offer' })}>
              <Plus className="h-4 w-4" aria-hidden /> Adicionar oferta
            </button>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {activeOffers.map((o) => (
              <OfferCard
                key={o.id}
                o={o}
                best={n.best?.offer_id === o.id}
                checking={checking === o.id}
                onCheck={() => checkNow(o)}
                onPrice={() => setModal({ kind: 'price', offer: o })}
                onShipping={() => setModal({ kind: 'shipping', offer: o })}
                onArchive={() => archive(o)}
              />
            ))}
          </div>
        )}
        {archived > 0 && <p className="muted mt-2 text-xs">{archived} oferta(s) arquivada(s); o histórico delas continua nas exportações.</p>}
      </section>

      {/* histórico */}
      <section className="card mt-8 p-4 sm:p-6" aria-labelledby="h-hist">
        <h2 id="h-hist" className="mb-1 text-lg font-semibold">
          Histórico de preços
        </h2>
        <p className="muted mb-4 text-xs">
          Preço {n.price_basis === 'cash' ? 'à vista' : 'total parcelado'} desde que você começou a acompanhar. Cada loja/oferta tem sua linha.
        </p>
        <PriceHistory offers={n.offers} basis={n.price_basis} target={n.target_price_cents} />
      </section>

      {/* compras */}
      <section className="mt-8" aria-labelledby="h-purchases">
        <h2 id="h-purchases" className="mb-3 text-lg font-semibold">
          Compras
        </h2>
        {n.purchases.length === 0 ? (
          <p className="muted text-sm">Nenhuma compra registrada.</p>
        ) : (
          <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
            {n.purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">
                    {p.quantity} × {brl(p.unit_price_cents)}
                    {p.shipping_cents > 0 && <span className="muted font-normal"> + frete {brl(p.shipping_cents)}</span>}
                  </div>
                  <div className="muted text-xs">
                    {p.store_label ?? 'Loja não informada'} · comprado em {dateBR(p.purchased_at)}
                    {p.delivered_at && ` · entregue em ${dateBR(p.delivered_at)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DeliveryBadge delivered={!!p.delivered_at} />
                  {!p.delivered_at && (
                    <button
                      className="btn-secondary min-h-[34px] px-3 text-xs"
                      onClick={async () => {
                        await api(`/api/purchases/${p.id}`, { method: 'PATCH', body: { delivered_at: todayISO() } })
                        await refresh()
                        toast('Entrega registrada')
                      }}
                    >
                      <Truck className="h-3.5 w-3.5" aria-hidden /> Chegou
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {n.alerts.length > 0 && (
        <section className="mt-8" aria-labelledby="h-alerts">
          <h2 id="h-alerts" className="mb-3 text-lg font-semibold">
            Alertas deste produto
          </h2>
          <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
            {n.alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="muted text-xs">{dateTimeBR(a.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddOfferModal open={modal?.kind === 'offer'} needId={n.id} onClose={() => setModal(null)} onDone={refresh} />
      {modal?.kind === 'price' && <ManualPriceModal offer={modal.offer} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'shipping' && <ShippingModal offer={modal.offer} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'purchase' && <PurchaseModal n={n} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  )
}

function OfferCard({
  o,
  best,
  checking,
  onCheck,
  onPrice,
  onShipping,
  onArchive,
}: {
  o: Offer
  best: boolean
  checking: boolean
  onCheck: () => void
  onPrice: () => void
  onShipping: () => void
  onArchive: () => void
}) {
  const l = o.latest
  const shipping = l?.shipping_known ? l.shipping_cents : o.shipping_cents_manual
  return (
    <article className={`card p-4 ${best ? 'ring-2 ring-brand-500/60' : ''}`} aria-label={`Oferta ${o.store_label}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-medium">
            {o.store_label}
            {best && (
              <Badge color="green" icon={<Tag className="h-3.5 w-3.5" aria-hidden />}>
                Melhor oferta
              </Badge>
            )}
          </h3>
          <p className="muted text-xs">
            {(() => {
              const s = l?.seller ?? o.seller
              if (!s) return 'Vendedor não informado'
              if (s === o.store_label) return 'Vendido pela própria loja'
              return `Vendedor: ${s}${o.seller ? ' (fixo)' : ''}`
            })()}
          </p>
        </div>
        <MonitorBadge status={o.monitor_status} title={o.last_error ?? undefined} />
      </header>

      {l ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="muted text-xs">À vista</dt>
            <dd className="text-lg font-semibold tabular-nums">{l.availability === 'out_of_stock' ? <span className="text-base text-stone-500">Sem estoque</span> : brl(l.price_cash_cents)}</dd>
          </div>
          <div>
            <dt className="muted text-xs">Parcelado</dt>
            <dd className="tabular-nums">{l.price_installment_total_cents ? `${brl(l.price_installment_total_cents)}${l.installments ? ` em ${l.installments}x` : ''}` : '—'}</dd>
          </div>
          <div>
            <dt className="muted text-xs">Frete</dt>
            <dd>
              {shipping === null || shipping === undefined ? (
                <span className="text-amber-700 dark:text-amber-400">Desconhecido</span>
              ) : (
                <span className="tabular-nums">
                  {shipping === 0 ? 'Grátis' : brl(shipping)}
                  {!l.shipping_known && <span className="muted text-xs"> (informado por você)</span>}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="muted text-xs">Atualizado</dt>
            <dd title={dateTimeBR(l.observed_at)}>
              {ago(l.observed_at)} · {l.source === 'auto' ? 'automático' : 'manual'}
            </dd>
          </div>
          {!!l.conditional && (
            <div className="col-span-2">
              <dt className="muted text-xs">Condição</dt>
              <dd>{l.conditional_note || 'Exige cupom ou clube'}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="muted mt-3 text-sm">Sem preço ainda. Use “Informar preço” depois de conferir no site.</p>
      )}

      {o.monitor_status === 'requer_intervencao' && o.last_error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/60 dark:text-red-300">
          {o.last_error}. O último preço válido continua salvo. Confira o link ou informe o preço manualmente.
        </p>
      )}
      {o.monitor_status === 'atrasado' && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          Preço desatualizado: não entra nos alertas até uma nova leitura.
        </p>
      )}

      <footer className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
        {o.url && (
          <a href={o.url} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[36px] px-3 text-xs">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Abrir na loja
          </a>
        )}
        {o.source === 'auto' && (
          <button className="btn-secondary min-h-[36px] px-3 text-xs" onClick={onCheck} disabled={checking}>
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Verificar agora
          </button>
        )}
        <button className="btn-secondary min-h-[36px] px-3 text-xs" onClick={onPrice}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Informar preço
        </button>
        <button className="btn-ghost min-h-[36px] px-3 text-xs" onClick={onShipping}>
          <Truck className="h-3.5 w-3.5" aria-hidden /> Frete
        </button>
        <button className="btn-ghost ml-auto min-h-[36px] px-3 text-xs" onClick={onArchive} aria-label={`Arquivar oferta ${o.store_label}`}>
          <Archive className="h-3.5 w-3.5" aria-hidden /> Arquivar
        </button>
      </footer>
    </article>
  )
}

function AddOfferModal({ open, needId, onClose, onDone }: { open: boolean; needId: number; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<OfferDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const toast = useToast()
  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/needs/${needId}/offers`, { method: 'POST', body: draftBody(draft) })
      toast(draft.kind === 'manual' ? 'Oferta adicionada. Agora informe o preço.' : 'Oferta adicionada e monitorada')
      setDraft(null)
      onDone()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar oferta"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={!draftReady(draft) || busy} onClick={save}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Adicionar
          </button>
        </>
      }
    >
      {open && <OfferPicker draft={draft} onChange={setDraft} />}
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>
    </Modal>
  )
}

function ManualPriceModal({ offer, onClose, onDone }: { offer: Offer; onClose: () => void; onDone: () => void }) {
  const l = offer.latest
  const [cash, setCash] = useState(centsToInput(l?.price_cash_cents))
  const [inst, setInst] = useState(centsToInput(l?.price_installment_total_cents))
  const [n, setN] = useState(l?.installments ? String(l.installments) : '')
  const [avail, setAvail] = useState<'in_stock' | 'out_of_stock'>('in_stock')
  const [shipKnown, setShipKnown] = useState(false)
  const [ship, setShip] = useState('')
  const [cond, setCond] = useState(false)
  const [condNote, setCondNote] = useState('')
  const [seller, setSeller] = useState(l?.seller ?? offer.seller ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const toast = useToast()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const c = parseBRL(cash)
    const i = parseBRL(inst)
    if (cash && c === null) return setError(new Error('Preço à vista inválido. Ex.: 1.299,90'))
    if (inst && i === null) return setError(new Error('Total parcelado inválido'))
    setBusy(true)
    try {
      await api(`/api/offers/${offer.id}/observations`, {
        method: 'POST',
        body: {
          price_cash_cents: avail === 'in_stock' ? c : null,
          price_installment_total_cents: avail === 'in_stock' ? i : null,
          installments: n ? Number(n) : null,
          availability: avail,
          shipping_known: shipKnown,
          shipping_cents: shipKnown ? parseBRL(ship) ?? 0 : null,
          conditional: cond,
          conditional_note: condNote,
          seller,
        },
      })
      toast('Preço registrado')
      onDone()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Informar preço · ${offer.store_label}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="manual-price" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
          </button>
        </>
      }
    >
      <form id="manual-price" onSubmit={submit} className="space-y-4">
        <p className="muted text-sm">Registre o que você viu no site agora. Fica no histórico como leitura manual.</p>
        <Segmented
          label="Estoque"
          value={avail}
          onChange={setAvail}
          options={[
            { value: 'in_stock', label: 'Disponível' },
            { value: 'out_of_stock', label: 'Sem estoque' },
          ]}
        />
        {avail === 'in_stock' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="À vista / Pix">{(id) => <MoneyInput id={id} value={cash} onChange={setCash} />}</Field>
              <Field label="Total parcelado" hint="Valor total, não a parcela">
                {(id) => <MoneyInput id={id} value={inst} onChange={setInst} />}
              </Field>
            </div>
            {inst && (
              <Field label="Número de parcelas">
                {(id) => <input id={id} className="input w-32" type="number" min={1} max={48} value={n} onChange={(e) => setN(e.target.value)} />}
              </Field>
            )}
            <Toggle checked={shipKnown} onChange={setShipKnown} label="Sei o valor do frete" description="Se não souber, o frete fica como desconhecido (nunca como zero)." />
            {shipKnown && <Field label="Frete">{(id) => <MoneyInput id={id} value={ship} onChange={setShip} placeholder="0,00 = grátis" />}</Field>}
            <Toggle checked={cond} onChange={setCond} label="Preço depende de cupom ou clube" />
            {cond && <Field label="Qual condição?">{(id) => <input id={id} className="input" placeholder="Ex.: cupom CASA10, clube Prime" value={condNote} onChange={(e) => setCondNote(e.target.value)} />}</Field>}
          </>
        )}
        <Field label="Vendedor">{(id) => <input id={id} className="input" value={seller} onChange={(e) => setSeller(e.target.value)} />}</Field>
        <ErrorBox error={error} />
      </form>
    </Modal>
  )
}

function ShippingModal({ offer, onClose, onDone }: { offer: Offer; onClose: () => void; onDone: () => void }) {
  const [known, setKnown] = useState(offer.shipping_cents_manual !== null)
  const [v, setV] = useState(centsToInput(offer.shipping_cents_manual))
  const [error, setError] = useState<unknown>(null)
  const toast = useToast()
  const save = async () => {
    const c = known ? parseBRL(v || '0') : null
    if (known && c === null) return setError(new Error('Valor inválido'))
    try {
      await api(`/api/offers/${offer.id}`, { method: 'PATCH', body: { shipping_cents_manual: c } })
      toast('Frete salvo')
      onDone()
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Frete · ${offer.store_label}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={save}>
            Salvar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="muted text-sm">As lojas não informam frete sem o carrinho. Se você consultou para o seu CEP, informe aqui: ele passa a valer para alertas de “produto + frete”.</p>
        <Toggle checked={known} onChange={setKnown} label="Sei o frete desta oferta" />
        {known && <Field label="Valor do frete">{(id) => <MoneyInput id={id} value={v} onChange={setV} placeholder="0,00 = grátis" />}</Field>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  )
}

function PurchaseModal({ n, onClose, onDone }: { n: NeedDetail; onClose: () => void; onDone: () => void }) {
  const offers = n.offers.filter((o) => o.status !== 'archived')
  const bestOffer = offers.find((o) => o.id === n.best?.offer_id) ?? offers[0]
  const [offerId, setOfferId] = useState(bestOffer ? String(bestOffer.id) : '')
  const [qty, setQty] = useState(String(n.remaining_qty || 1))
  const [price, setPrice] = useState(centsToInput(bestOffer?.latest?.price_cash_cents))
  const [ship, setShip] = useState('')
  const [date, setDate] = useState(todayISO())
  const [delivered, setDelivered] = useState(false)
  const [storeLabel, setStoreLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const toast = useToast()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const unit = parseBRL(price)
    if (unit === null) return setError(new Error('Informe o preço pago por unidade'))
    setBusy(true)
    try {
      await api(`/api/needs/${n.id}/purchases`, {
        method: 'POST',
        body: {
          offer_id: offerId ? Number(offerId) : null,
          store_label: offerId ? undefined : storeLabel,
          quantity: Number(qty),
          unit_price_cents: unit,
          shipping_cents: parseBRL(ship) ?? 0,
          purchased_at: date,
          delivered_at: delivered ? date : null,
        },
      })
      toast(Number(qty) >= n.remaining_qty ? 'Compra registrada. Monitoramento encerrado para este item.' : 'Compra parcial registrada')
      onDone()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Marcar como comprado"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="purchase" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Registrar compra
          </button>
        </>
      }
    >
      <form id="purchase" onSubmit={submit} className="space-y-4">
        <Field label="Onde comprou">
          {(id) => (
            <select
              id={id}
              className="input"
              value={offerId}
              onChange={(e) => {
                setOfferId(e.target.value)
                const o = offers.find((x) => String(x.id) === e.target.value)
                if (o?.latest?.price_cash_cents) setPrice(centsToInput(o.latest.price_cash_cents))
              }}
            >
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.store_label}
                  {o.latest?.price_cash_cents ? ` · ${brl(o.latest.price_cash_cents)}` : ''}
                </option>
              ))}
              <option value="">Outra loja</option>
            </select>
          )}
        </Field>
        {!offerId && <Field label="Nome da loja">{(id) => <input id={id} className="input" value={storeLabel} onChange={(e) => setStoreLabel(e.target.value)} />}</Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade" hint={`Faltam ${n.remaining_qty}`}>
            {(id) => <input id={id} className="input" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} />}
          </Field>
          <Field label="Data">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço pago por unidade">{(id) => <MoneyInput id={id} value={price} onChange={setPrice} required />}</Field>
          <Field label="Frete pago">{(id) => <MoneyInput id={id} value={ship} onChange={setShip} />}</Field>
        </div>
        <Toggle checked={delivered} onChange={setDelivered} label="Já foi entregue" />
        <ErrorBox error={error} />
      </form>
    </Modal>
  )
}
