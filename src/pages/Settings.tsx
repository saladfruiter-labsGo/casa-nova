import { ReactNode, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Loader2, LogOut, Pencil, Plus, Save, Send, Trash2 } from 'lucide-react'
import { api, Category, Room, StoreInfo } from '../lib/api'
import { brl, centsToInput, dateTimeBR, parseBRL } from '../lib/format'
import { Badge, ErrorBox, Field, MoneyInput, PageHeader, useToast } from '../components/ui'

interface Settings {
  cep: string | null
  interval_hours: number
  telegram: { token_configured: boolean; chat_linked: boolean; chat_from_env: boolean; last_sent_at: string | null; failed: number }
  version: string
}

function Card({ id, title, desc, children }: { id?: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-24 p-4 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {desc && <p className="muted mt-0.5 text-sm">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function SettingsPage() {
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') })
  useEffect(() => {
    if (location.hash && s.data) document.querySelector(location.hash)?.scrollIntoView()
  }, [s.data])
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Configurações" subtitle={s.data ? `Versão ${s.data.version}` : undefined} />
      <Telegram s={s.data} />
      <NamedList kind="rooms" title="Cômodos" desc="Organize a lista por ambiente e defina quanto pretende gastar em cada um." />
      <NamedList kind="categories" title="Categorias" desc="Tipos de produto: eletrodomésticos, móveis, iluminação…" />
      <General s={s.data} />
      <Stores />
      <Data />
      <button
        className="btn-ghost"
        onClick={async () => {
          await api('/api/auth/logout', { method: 'POST', body: {} })
          location.href = '/'
        }}
      >
        <LogOut className="h-4 w-4" aria-hidden /> Sair
      </button>
    </div>
  )
}

function Telegram({ s }: { s?: Settings }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const t = s?.telegram
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
      qc.invalidateQueries({ queryKey: ['settings'] })
    }
  }
  return (
    <Card id="telegram" title="Telegram" desc="Receba os alertas no celular. Só o seu chat, vinculado com um código, recebe mensagens.">
      {!t ? null : !t.token_configured ? (
        <div className="space-y-2 text-sm">
          <p>
            <Badge color="amber">Bot não configurado</Badge>
          </p>
          <p className="muted">
            Crie um bot exclusivo no <strong>@BotFather</strong> e coloque o token na variável <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">TELEGRAM_BOT_TOKEN</code> do servidor (arquivo
            .env). O token nunca fica salvo no app.
          </p>
        </div>
      ) : t.chat_linked ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-brand-600" aria-hidden /> Chat vinculado
            {t.last_sent_at && <span className="muted">· última mensagem {dateTimeBR(t.last_sent_at)}</span>}
          </p>
          {t.failed > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">{t.failed} mensagem(ns) não puderam ser enviadas; elas continuam na central de alertas.</p>}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={!!busy}
              onClick={() =>
                run('test', async () => {
                  await api('/api/telegram/test', { method: 'POST', body: {} })
                  toast('Mensagem de teste enviada. Confira o Telegram.')
                })
              }
            >
              {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden />} Enviar teste
            </button>
            {!t.chat_from_env && (
              <button className="btn-ghost" disabled={!!busy} onClick={() => run('unlink', async () => void (await api('/api/telegram/link', { method: 'DELETE' })))}>
                Desvincular
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <ol className="muted list-decimal space-y-1 pl-5">
            <li>Gere um código abaixo.</li>
            <li>No Telegram, envie para o seu bot: <strong>/vincular código</strong>.</li>
            <li>Volte aqui e clique em “Verificar”.</li>
          </ol>
          {code && (
            <p className="rounded-xl bg-stone-100 p-3 font-mono text-base dark:bg-stone-800">
              /vincular {code} <span className="muted font-sans text-xs">(vale 10 min)</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={!!busy}
              onClick={() => run('code', async () => setCode((await api<{ code: string }>('/api/telegram/link-code', { method: 'POST', body: {} })).code))}
            >
              {code ? 'Gerar outro código' : 'Gerar código'}
            </button>
            {code && (
              <button
                className="btn-primary"
                disabled={!!busy}
                onClick={() =>
                  run('check', async () => {
                    const r = await api<{ linked: boolean; message: string }>('/api/telegram/link-check', { method: 'POST', body: {} })
                    setMsg(r.message)
                    if (r.linked) setCode(null)
                  })
                }
              >
                {busy === 'check' && <Loader2 className="h-4 w-4 animate-spin" />} Verificar
              </button>
            )}
          </div>
          {msg && <p role="status">{msg}</p>}
        </div>
      )}
    </Card>
  )
}

function NamedList({ kind, title, desc }: { kind: 'rooms' | 'categories'; title: string; desc: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: [kind], queryFn: () => api<(Room & Category)[]>(`/api/${kind}`) })
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [edit, setEdit] = useState<{ id: number; name: string; budget: string } | null>(null)
  const isRoom = kind === 'rooms'
  const refresh = () => qc.invalidateQueries()
  const add = async () => {
    try {
      await api(`/api/${kind}`, { method: 'POST', body: { name, budget_cents: isRoom ? parseBRL(budget) : undefined } })
      setName('')
      setBudget('')
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const save = async () => {
    if (!edit) return
    try {
      await api(`/api/${kind}/${edit.id}`, { method: 'PATCH', body: { name: edit.name, ...(isRoom ? { budget_cents: parseBRL(edit.budget) } : {}) } })
      setEdit(null)
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <Card title={title} desc={desc}>
      {q.error ? <ErrorBox error={q.error} /> : null}
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {q.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
            {edit?.id === r.id ? (
              <>
                <input aria-label="Nome" className="input min-w-0 flex-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                {isRoom && (
                  <div className="w-36">
                    <MoneyInput value={edit.budget} onChange={(v) => setEdit({ ...edit, budget: v })} placeholder="Orçamento" />
                  </div>
                )}
                <button className="btn-primary px-3" onClick={save} aria-label="Salvar">
                  <Save className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{r.name}</span>
                {isRoom && <span className="muted text-sm tabular-nums">{r.budget_cents !== null ? brl(r.budget_cents) : 'sem orçamento'}</span>}
                <button className="btn-ghost px-2" aria-label={`Editar ${r.name}`} onClick={() => setEdit({ id: r.id, name: r.name, budget: centsToInput(r.budget_cents) })}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="btn-ghost px-2"
                  aria-label={`Excluir ${r.name}`}
                  onClick={async () => {
                    if (!confirm(`Excluir “${r.name}”? Os produtos continuam, apenas sem ${isRoom ? 'cômodo' : 'categoria'}.`)) return
                    await api(`/api/${kind}/${r.id}`, { method: 'DELETE' })
                    refresh()
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void add()
        }}
      >
        <input aria-label={`Novo ${isRoom ? 'cômodo' : 'categoria'}`} className="input min-w-0 flex-1" placeholder={isRoom ? 'Novo cômodo' : 'Nova categoria'} value={name} onChange={(e) => setName(e.target.value)} />
        {isRoom && (
          <div className="w-36">
            <MoneyInput value={budget} onChange={setBudget} placeholder="Orçamento" />
          </div>
        )}
        <button className="btn-secondary" disabled={!name.trim()}>
          <Plus className="h-4 w-4" aria-hidden /> Adicionar
        </button>
      </form>
    </Card>
  )
}

function General({ s }: { s?: Settings }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [cep, setCep] = useState('')
  const [hours, setHours] = useState('6')
  useEffect(() => {
    if (s) {
      setCep(s.cep ?? '')
      setHours(String(s.interval_hours))
    }
  }, [s])
  const save = async () => {
    try {
      await api('/api/settings', { method: 'PATCH', body: { cep, interval_hours: Number(hours) } })
      toast('Preferências salvas')
      qc.invalidateQueries({ queryKey: ['settings'] })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <Card title="Preferências">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CEP de entrega" hint="Registrado junto de cada leitura de preço para comparação.">
          {(id) => <input id={id} className="input" inputMode="numeric" placeholder="00000-000" value={cep} onChange={(e) => setCep(e.target.value)} />}
        </Field>
        <Field label="Verificar preços a cada" hint="Entre 3 e 48 horas. Intervalos curtos aumentam o risco de bloqueio pelas lojas.">
          {(id) => (
            <select id={id} className="input" value={hours} onChange={(e) => setHours(e.target.value)}>
              {[3, 6, 12, 24, 48].map((h) => (
                <option key={h} value={h}>
                  {h} horas
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <button className="btn-primary mt-4" onClick={save}>
        Salvar
      </button>
    </Card>
  )
}

const STORE_STATUS: Record<string, [string, 'green' | 'amber' | 'red' | 'gray']> = {
  viavel: ['Leitura automática', 'green'],
  parcial: ['Leitura parcial', 'amber'],
  indisponivel: ['Só preço manual', 'gray'],
  pendente: ['Pendente', 'gray'],
}

function Stores() {
  const q = useQuery({ queryKey: ['stores'], queryFn: () => api<StoreInfo[]>('/api/stores') })
  return (
    <Card title="Lojas" desc="Resultado da prova de coleta. Lojas sem leitura automática continuam aceitas com preço manual.">
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {q.data?.map((s) => {
          const [label, color] = STORE_STATUS[s.status]
          return (
            <li key={s.key} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{s.label}</span>
                <Badge color={color}>{label}</Badge>
              </div>
              <p className="muted mt-0.5 text-xs">{s.note}</p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Data() {
  const toast = useToast()
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api<{ file: string; size: number }[]>('/api/backups') })
  const [busy, setBusy] = useState(false)
  return (
    <Card title="Seus dados" desc="Exporte para planilha a qualquer momento. Backups do banco são feitos todo dia automaticamente.">
      <div className="flex flex-wrap gap-2">
        {[
          ['needs', 'Produtos'],
          ['offers', 'Ofertas'],
          ['observations', 'Histórico de preços'],
          ['purchases', 'Compras'],
        ].map(([k, l]) => (
          <a key={k} className="btn-secondary" href={`/api/export/${k}.csv`} download>
            <Download className="h-4 w-4" aria-hidden /> {l} (CSV)
          </a>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await api('/api/backups', { method: 'POST', body: {} })
              toast('Backup criado e verificado')
              backups.refetch()
            } catch (e) {
              toast((e as Error).message, 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Fazer backup agora
        </button>
        <span className="muted text-xs">
          {backups.data?.length ? `${backups.data.length} backup(s) guardados · último: ${backups.data[0].file.replace(/^casa-nova-|\.db$/g, '')}` : 'Nenhum backup ainda'}
        </span>
      </div>
    </Card>
  )
}
