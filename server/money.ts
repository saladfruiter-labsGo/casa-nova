/** Valores monetários sempre em centavos inteiros. Sem ponto flutuante em armazenamento. */

/** Converte número (ex.: 1234.5) ou texto ("R$ 1.234,50", "1234.50", "1.234") em centavos. */
export function toCents(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null
    return Math.round(input * 100)
  }
  if (typeof input !== 'string') return null
  let s = input.replace(/\s|\u00a0/g, '').replace(/^R\$/i, '')
  if (!/^\d[\d.,]*$/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastComma > lastDot) {
    // formato brasileiro: 1.234,56
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > -1 && lastComma > -1) {
    // formato 1,234.56
    s = s.replace(/,/g, '')
  } else if (lastDot > -1) {
    // só pontos: "1234.56" (decimal) ou "1.234" / "1.234.567" (milhar)
    const parts = s.split('.')
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)
    if (isThousands) s = s.replace(/\./g, '')
  }
  const [int, frac = ''] = s.split('.')
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac) || frac.length > 2) return null
  return Number(int) * 100 + Number(frac.padEnd(2, '0') || '0')
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  const neg = cents < 0
  const abs = Math.abs(cents)
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const frac = String(abs % 100).padStart(2, '0')
  return `${neg ? '-' : ''}R$ ${int},${frac}`
}
