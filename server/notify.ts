import { DB, getSetting, setSetting } from './db.ts'

/** Token do bot só por variável de ambiente; nunca no banco, no repositório ou nos logs. */
export function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null
}
export function telegramChatId(db: DB): string | null {
  return process.env.TELEGRAM_CHAT_ID?.trim() || getSetting(db, 'telegram_chat_id')
}

const redact = (s: string) => s.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>')

export type TelegramApi = (method: string, body: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; description?: string }>

export const realTelegramApi: TelegramApi = async (method, body) => {
  const token = telegramToken()
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN não configurado' }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const j = (await r.json()) as { ok: boolean; result?: unknown; description?: string }
    return j
  } catch (e) {
    return { ok: false, description: redact(`Falha de rede: ${(e as Error).message}`) }
  }
}

export function enqueueTelegram(db: DB, dedupeKey: string, text: string, now = new Date()) {
  db.prepare(
    `INSERT OR IGNORE INTO outbox(dedupe_key, channel, payload, next_attempt_at, created_at) VALUES (?, 'telegram', ?, ?, ?)`,
  ).run(dedupeKey, JSON.stringify({ text }), now.toISOString(), now.toISOString())
}

const MAX_ATTEMPTS = 6

/** Processa a outbox: cada mensagem é enviada no máximo uma vez com sucesso; falhas com backoff. */
export async function processOutbox(db: DB, api: TelegramApi = realTelegramApi, now = new Date()): Promise<number> {
  const rows = db
    .prepare(`SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 10`)
    .all(now.toISOString()) as { id: number; payload: string; attempts: number }[]
  let sent = 0
  const chatId = telegramChatId(db)
  for (const row of rows) {
    if (!telegramToken() || !chatId) {
      db.prepare(`UPDATE outbox SET status='failed', last_error=? WHERE id=?`).run(
        'Telegram não configurado (alerta ficou só na central)',
        row.id,
      )
      continue
    }
    // reserva a linha (evita envio duplo se houver dois processos)
    const claim = db
      .prepare(`UPDATE outbox SET next_attempt_at = ? WHERE id = ? AND status = 'pending' AND next_attempt_at <= ?`)
      .run(new Date(now.getTime() + 5 * 60_000).toISOString(), row.id, now.toISOString())
    if (claim.changes === 0) continue
    const { text } = JSON.parse(row.payload) as { text: string }
    const r = await api('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true })
    if (r.ok) {
      db.prepare(`UPDATE outbox SET status='sent', sent_at=?, attempts=attempts+1, last_error=NULL WHERE id=?`).run(new Date().toISOString(), row.id)
      sent++
    } else {
      const attempts = row.attempts + 1
      const delayMin = Math.min(60, 2 ** attempts)
      db.prepare(`UPDATE outbox SET status=?, attempts=?, last_error=?, next_attempt_at=? WHERE id=?`).run(
        attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        redact(r.description ?? 'erro desconhecido'),
        new Date(now.getTime() + delayMin * 60_000).toISOString(),
        row.id,
      )
    }
  }
  return sent
}

// ----------------------------------------------- vínculo do chat autorizado (código de uso único)

export function createLinkCode(db: DB): string {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  setSetting(db, 'telegram_link_code', JSON.stringify({ code, exp: Date.now() + 10 * 60_000 }))
  return code
}

/**
 * Procura a mensagem "/vincular CODIGO" enviada ao bot por um chat privado.
 * Usar um bot exclusivo do Casa Nova: getUpdates conflita com outro programa usando o mesmo bot.
 */
export async function checkLinkCode(db: DB, api: TelegramApi = realTelegramApi): Promise<{ linked: boolean; message: string }> {
  const raw = getSetting(db, 'telegram_link_code')
  if (!raw) return { linked: false, message: 'Gere um código primeiro.' }
  const { code, exp } = JSON.parse(raw) as { code: string; exp: number }
  if (Date.now() > exp) return { linked: false, message: 'Código expirado. Gere outro.' }
  const r = await api('getUpdates', { timeout: 0, allowed_updates: ['message'] })
  if (!r.ok) return { linked: false, message: r.description ?? 'Falha ao consultar o bot' }
  const updates = (r.result ?? []) as { update_id: number; message?: { text?: string; chat: { id: number; type: string } } }[]
  const hit = updates.find((u) => u.message?.chat.type === 'private' && u.message.text?.trim().replace(/^\/vincular\s*/i, '') === code)
  if (!hit?.message) return { linked: false, message: `Mensagem não encontrada. Envie "/vincular ${code}" ao bot e tente de novo.` }
  setSetting(db, 'telegram_chat_id', String(hit.message.chat.id))
  setSetting(db, 'telegram_link_code', null)
  // confirma leitura dos updates para não reprocessar
  await api('getUpdates', { offset: hit.update_id + 1, timeout: 0 })
  return { linked: true, message: 'Chat vinculado. Envie uma mensagem de teste para confirmar o recebimento.' }
}
