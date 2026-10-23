import { useMemo } from 'react'
import type { Observation, Offer } from '../lib/api'
import { brl, dateTimeBR } from '../lib/format'

const COLORS = ['#059669', '#2563eb', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#65a30d', '#dc2626']

/** Histórico por oferta (série escolhida). Linhas separadas por oferta: troca de loja/vendedor não vira "desconto". */
export function PriceHistory({ offers, basis, target }: { offers: Offer[]; basis: 'cash' | 'installment'; target: number | null }) {
  const series = useMemo(
    () =>
      offers
        .filter((o) => o.status !== 'archived')
        .map((o, i) => ({
          offer: o,
          color: COLORS[i % COLORS.length],
          points: o.observations
            .map((ob: Observation) => ({ t: new Date(ob.observed_at).getTime(), v: basis === 'cash' ? ob.price_cash_cents : ob.price_installment_total_cents, ob }))
            .filter((p): p is { t: number; v: number; ob: Observation } => p.v !== null && p.ob.availability !== 'out_of_stock'),
        }))
        .filter((s) => s.points.length > 0),
    [offers, basis],
  )
  const all = series.flatMap((s) => s.points)
  if (all.length < 2)
    return <p className="muted text-sm">O gráfico aparece quando houver pelo menos duas leituras de preço. As leituras automáticas acontecem algumas vezes por dia.</p>

  const W = 640
  const H = 220
  const P = { l: 64, r: 12, t: 12, b: 28 }
  const t0 = Math.min(...all.map((p) => p.t))
  const t1 = Math.max(...all.map((p) => p.t))
  const vals = all.map((p) => p.v).concat(target ? [target] : [])
  let v0 = Math.min(...vals)
  let v1 = Math.max(...vals)
  const pad = Math.max(1, (v1 - v0) * 0.1)
  v0 = Math.max(0, v0 - pad)
  v1 = v1 + pad
  const x = (t: number) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - v0) / Math.max(1, v1 - v0)) * (H - P.t - P.b)
  const ticks = [v0, (v0 + v1) / 2, v1]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Gráfico do histórico de preços por oferta. A tabela abaixo tem os mesmos dados.">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="stroke-stone-200 dark:stroke-stone-800" />
            <text x={P.l - 6} y={y(v) + 4} textAnchor="end" className="fill-stone-500 text-[11px]">
              {brl(Math.round(v)).replace(',00', '')}
            </text>
          </g>
        ))}
        {target !== null && target >= v0 && target <= v1 && (
          <g>
            <line x1={P.l} x2={W - P.r} y1={y(target)} y2={y(target)} stroke="#059669" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={W - P.r} y={y(target) - 5} textAnchor="end" className="fill-brand-700 text-[11px] font-medium dark:fill-brand-400">
              seu alvo
            </text>
          </g>
        )}
        {series.map((s) => (
          <g key={s.offer.id}>
            <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} />
            {s.points.map((p) => (
              <circle key={p.ob.id} cx={x(p.t)} cy={y(p.v)} r={3} fill={s.color}>
                <title>{`${s.offer.store_label}: ${brl(p.v)} em ${dateTimeBR(p.ob.observed_at)}`}</title>
              </circle>
            ))}
          </g>
        ))}
        <text x={P.l} y={H - 6} className="fill-stone-500 text-[11px]">
          {dateTimeBR(new Date(t0).toISOString())}
        </text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="fill-stone-500 text-[11px]">
          {dateTimeBR(new Date(t1).toISOString())}
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.offer.id} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.offer.store_label}
            {s.offer.seller ? ` · ${s.offer.seller}` : ''}
          </li>
        ))}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="muted cursor-pointer select-none">Ver como tabela</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="muted sticky top-0 bg-white dark:bg-stone-900">
              <tr>
                <th className="py-1 pr-2 font-medium">Quando</th>
                <th className="py-1 pr-2 font-medium">Loja</th>
                <th className="py-1 pr-2 font-medium">Vendedor</th>
                <th className="py-1 pr-2 text-right font-medium">Preço</th>
                <th className="py-1 font-medium">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {series
                .flatMap((s) => s.points.map((p) => ({ ...p, s })))
                .sort((a, b) => b.t - a.t)
                .map((p) => (
                  <tr key={p.ob.id} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="py-1 pr-2">{dateTimeBR(p.ob.observed_at)}</td>
                    <td className="py-1 pr-2">{p.s.offer.store_label}</td>
                    <td className="py-1 pr-2">{p.ob.seller ?? '—'}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{brl(p.v)}</td>
                    <td className="py-1">{p.ob.source === 'auto' ? 'automática' : 'manual'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
