import { ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  Hand,
  Loader2,
  PackageCheck,
  PauseCircle,
  Radar,
  ShoppingBag,
  Truck,
  X,
  XCircle,
} from 'lucide-react'
import type { MonitorStatus, NeedStatus } from '../lib/api'

// ------------------------------------------------------------------ badges (texto + ícone, nunca só cor)

const tone = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20',
  blue: 'bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-400/20',
  amber: 'bg-amber-50 text-amber-900 ring-amber-600/25 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20',
  red: 'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/20',
  gray: 'bg-stone-100 text-stone-700 ring-stone-500/20 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-400/20',
  violet: 'bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/20',
}

export function Badge({ color = 'gray', icon, children, title }: { color?: keyof typeof tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone[color]}`}>
      {icon}
      {children}
    </span>
  )
}

const ic = 'h-3.5 w-3.5'
export function NeedStatusBadge({ status }: { status: NeedStatus }) {
  const map: Record<NeedStatus, [keyof typeof tone, ReactNode, string]> = {
    planejado: ['gray', <Circle className={ic} aria-hidden />, 'Planejado'],
    monitorando: ['blue', <Radar className={ic} aria-hidden />, 'Monitorando'],
    comprado: ['violet', <ShoppingBag className={ic} aria-hidden />, 'Comprado'],
    entregue: ['green', <PackageCheck className={ic} aria-hidden />, 'Entregue'],
    cancelado: ['gray', <XCircle className={ic} aria-hidden />, 'Cancelado'],
  }
  const [c, i, l] = map[status]
  return (
    <Badge color={c} icon={i}>
      {l}
    </Badge>
  )
}

export const MONITOR_LABEL: Record<MonitorStatus, string> = {
  ativo: 'Atualizado',
  atrasado: 'Desatualizado',
  indisponivel: 'Sem estoque',
  requer_intervencao: 'Precisa de atenção',
  pausado: 'Pausado',
  manual: 'Preço manual',
  aguardando: 'Aguardando leitura',
  sem_ofertas: 'Sem ofertas',
}

export function MonitorBadge({ status, title }: { status: MonitorStatus; title?: string }) {
  const map: Record<MonitorStatus, [keyof typeof tone, ReactNode]> = {
    ativo: ['green', <CheckCircle2 className={ic} aria-hidden />],
    atrasado: ['amber', <Clock className={ic} aria-hidden />],
    indisponivel: ['gray', <XCircle className={ic} aria-hidden />],
    requer_intervencao: ['red', <AlertTriangle className={ic} aria-hidden />],
    pausado: ['gray', <PauseCircle className={ic} aria-hidden />],
    manual: ['gray', <Hand className={ic} aria-hidden />],
    aguardando: ['gray', <CircleDashed className={ic} aria-hidden />],
    sem_ofertas: ['gray', <CircleDashed className={ic} aria-hidden />],
  }
  const [c, i] = map[status]
  return (
    <Badge color={c} icon={i} title={title}>
      {MONITOR_LABEL[status]}
    </Badge>
  )
}

export function DeliveryBadge({ delivered }: { delivered: boolean }) {
  return delivered ? (
    <Badge color="green" icon={<PackageCheck className={ic} aria-hidden />}>
      Entregue
    </Badge>
  ) : (
    <Badge color="amber" icon={<Truck className={ic} aria-hidden />}>
      A caminho
    </Badge>
  )
}

// ------------------------------------------------------------------ layout

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-2xl bg-brand-50 p-3 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{icon}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <p className="muted mt-1 max-w-md text-sm">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="muted flex items-center justify-center gap-2 py-16 text-sm">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">{(error as Error).message ?? String(error)}</div>
      {onRetry && (
        <button className="font-medium underline" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  )
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; error?: string | null }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  )
}

export function MoneyInput({ id, value, onChange, placeholder = '0,00', required }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div className="relative">
      <span className="muted pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm">R$</span>
      <input
        id={id}
        className="input pl-10 tabular-nums"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
      />
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-xl border border-stone-300 bg-stone-100 p-1 dark:border-stone-700 dark:bg-stone-900 sm:w-auto">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[36px] flex-1 rounded-lg px-3 text-sm font-medium transition-colors sm:flex-none ${
            value === o.value ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white' : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="hint mt-0.5">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-stone-300 dark:bg-stone-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ modal (dialog nativo: foco e Esc acessíveis)

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[92vh] w-full max-w-none rounded-t-3xl bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/50 dark:bg-stone-900 dark:text-stone-100 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-5 py-3 dark:border-stone-800">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setList((l) => [...l, { id, text, kind }])
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {list.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
              t.kind === 'error' ? 'bg-red-700 text-white' : 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
            }`}
          >
            {t.kind === 'error' ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function ProductThumb({ src, alt, size = 'md' }: { src: string | null; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  const cls = size === 'sm' ? 'h-12 w-12' : size === 'lg' ? 'h-28 w-28 sm:h-36 sm:w-36' : 'h-16 w-16'
  return (
    <div className={`${cls} flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-800`}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-1" />
      ) : (
        <ShoppingBag className="h-6 w-6 text-stone-400" aria-hidden />
      )}
    </div>
  )
}
