export function brl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Converte texto digitado ("1.299,90", "1299.9", "1299") em centavos; null se vazio/ inválido. */
export function parseBRL(input: string): number | null {
  const s = input.replace(/\s|R\$/g, '')
  if (!s) return null
  let norm = s
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null
  const [i, f = ''] = norm.split('.')
  return Number(i) * 100 + Number(f.padEnd(2, '0'))
}

export function centsToInput(c: number | null | undefined): string {
  if (c === null || c === undefined) return ''
  return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'agora'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

export function dateBR(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00') : new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const PRIORITY_LABEL: Record<number, string> = { 1: 'Alta', 2: 'Média', 3: 'Baixa' }

export function variantLine(n: { brand?: string | null; model?: string | null; voltage?: string | null; color?: string | null }) {
  return [n.brand, n.model, n.voltage, n.color].filter(Boolean).join(' · ')
}
