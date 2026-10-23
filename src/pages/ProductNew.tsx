import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { api } from '../lib/api'
import { PageHeader, useToast } from '../components/ui'
import { NeedForm, emptyNeed } from '../components/NeedForm'
import { OfferDraft, OfferPicker, draftBody, draftReady } from '../components/OfferPicker'

export default function ProductNew() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState<1 | 2>(1)
  const [draft, setDraft] = useState<OfferDraft | null>(null)

  const initial =
    draft?.kind === 'preview'
      ? emptyNeed({ title: draft.preview.title?.slice(0, 200) ?? '', brand: draft.preview.brand ?? '', ean: draft.preview.ean ?? '' })
      : emptyNeed()

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Adicionar produto" subtitle={step === 1 ? 'Passo 1 de 2 · De onde vem o preço' : 'Passo 2 de 2 · Detalhes e preço desejado'} />
      <ol className="mb-6 grid grid-cols-2 gap-2" aria-label="Etapas">
        {['Oferta', 'Detalhes'].map((l, i) => (
          <li key={l} aria-current={step === i + 1 ? 'step' : undefined} className={`h-1.5 rounded-full ${step >= i + 1 ? 'bg-brand-500' : 'bg-stone-200 dark:bg-stone-800'}`}>
            <span className="sr-only">{l}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="card space-y-5 p-4 sm:p-6">
          <OfferPicker draft={draft} onChange={setDraft} />
          <div className="flex flex-col-reverse gap-2 border-t border-stone-100 pt-4 dark:border-stone-800 sm:flex-row sm:justify-between">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setDraft(null)
                setStep(2)
              }}
            >
              Pular: cadastrar sem oferta por enquanto
            </button>
            <button type="button" className="btn-primary" disabled={!draftReady(draft)} onClick={() => setStep(2)}>
              Continuar <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <button className="btn-ghost -ml-2 mb-3" onClick={() => setStep(1)}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar para a oferta
          </button>
          <NeedForm
            key={draft?.kind === 'preview' ? draft.preview.preview_id : 'manual'}
            initial={initial}
            submitLabel="Salvar produto"
            onCancel={() => nav('/produtos')}
            onSubmit={async (payload) => {
              const { id } = await api<{ id: number }>('/api/needs', { method: 'POST', body: payload })
              if (draft) {
                try {
                  await api(`/api/needs/${id}/offers`, { method: 'POST', body: draftBody(draft) })
                } catch (e) {
                  toast(`Produto salvo, mas a oferta não: ${(e as Error).message}`, 'error')
                }
              }
              await qc.invalidateQueries()
              toast('Produto adicionado')
              nav(`/produtos/${id}`, { replace: true })
            }}
          />
        </>
      )}
    </div>
  )
}
