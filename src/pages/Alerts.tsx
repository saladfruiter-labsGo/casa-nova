import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, ExternalLink, Send } from 'lucide-react'
import { AlertItem, api } from '../lib/api'
import { dateTimeBR } from '../lib/format'
import { Badge, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui'

const KIND: Record<string, string> = { target: 'Preço desejado', target_new_low: 'Caiu mais', drop: 'Queda de preço', restock: 'Voltou ao estoque' }

export default function Alerts() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api<AlertItem[]>('/api/alerts') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ telegram: { token_configured: boolean; chat_linked: boolean } }>('/api/settings') })
  const read = async (a?: AlertItem) => {
    await api(a ? `/api/alerts/${a.id}/read` : '/api/alerts/read-all', { method: 'POST', body: {} })
    await qc.invalidateQueries({ queryKey: ['alerts'] })
    await qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const unread = q.data.filter((a) => !a.read_at).length
  const tg = settings.data?.telegram
  return (
    <>
      <PageHeader
        title="Alertas"
        subtitle={unread ? `${unread} não lido(s)` : 'Tudo lido'}
        actions={
          unread > 0 && (
            <button className="btn-secondary" onClick={() => read()}>
              <CheckCheck className="h-4 w-4" aria-hidden /> Marcar todos como lidos
            </button>
          )
        }
      />
      {tg && !(tg.token_configured && tg.chat_linked) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4" aria-hidden /> Os alertas ficam aqui. Para recebê-los também no celular, conecte o Telegram.
          </span>
          <Link to="/configuracoes#telegram" className="btn-secondary min-h-[36px]">
            Conectar Telegram
          </Link>
        </div>
      )}
      {q.data.length === 0 ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="Nenhum alerta ainda">
          Defina um preço desejado nos produtos. Quando uma oferta disponível chegar nele, o aviso aparece aqui e no Telegram.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {q.data.map((a) => (
            <li key={a.id} className={`card p-4 ${a.read_at ? 'opacity-75' : 'border-l-4 border-l-brand-500'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={a.read_at ? 'gray' : 'green'}>{KIND[a.kind] ?? a.kind}</Badge>
                    {!a.read_at && <span className="text-xs font-medium text-brand-700 dark:text-brand-400">Novo</span>}
                    <span className="muted text-xs">{dateTimeBR(a.created_at)}</span>
                    {a.telegram_status === 'sent' && <span className="muted text-xs">· enviado no Telegram</span>}
                    {a.telegram_status === 'failed' && <span className="text-xs text-amber-700 dark:text-amber-400">· não enviado no Telegram</span>}
                  </div>
                  <h2 className="mt-1.5 font-medium">{a.title}</h2>
                </div>
              </div>
              <pre className="muted mt-2 whitespace-pre-wrap font-sans text-sm">{a.body}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                {a.url && (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn-primary min-h-[36px] px-3 text-xs">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Conferir na loja
                  </a>
                )}
                {a.need_id && (
                  <Link to={`/produtos/${a.need_id}`} className="btn-secondary min-h-[36px] px-3 text-xs" onClick={() => !a.read_at && read(a)}>
                    Ver produto
                  </Link>
                )}
                {!a.read_at && (
                  <button className="btn-ghost min-h-[36px] px-3 text-xs" onClick={() => read(a)}>
                    Marcar como lido
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
