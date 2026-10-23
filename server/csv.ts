/** CSV com separador ';' (padrão do Excel em pt-BR) e proteção contra injeção de fórmulas. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return ''
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n') + '\r\n'
}
