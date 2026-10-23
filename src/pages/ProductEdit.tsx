import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, NeedDetail } from '../lib/api'
import { ErrorBox, PageHeader, Spinner, useToast } from '../components/ui'
import { NeedForm, needToForm } from '../components/NeedForm'

export default function ProductEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['need', id], queryFn: () => api<NeedDetail>(`/api/needs/${id}`) })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Editar produto" subtitle={q.data.title} />
      <NeedForm
        initial={needToForm(q.data)}
        submitLabel="Salvar alterações"
        onCancel={() => nav(-1)}
        onSubmit={async (payload) => {
          await api(`/api/needs/${id}`, { method: 'PATCH', body: payload })
          await qc.invalidateQueries()
          toast('Alterações salvas')
          nav(`/produtos/${id}`, { replace: true })
        }}
      />
    </div>
  )
}
