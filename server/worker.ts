import { DB, nowIso, pruneBackups, snapshot } from './db.ts'
import { collectOffer, CollectDeps } from './core.ts'
import { processOutbox, TelegramApi, realTelegramApi } from './notify.ts'

/**
 * Worker no mesmo processo, com agenda persistente no banco (next_check_at / outbox).
 * Reinício não perde trabalho: ofertas vencidas e mensagens pendentes são retomadas.
 */
export function dueOffers(db: DB, now: Date, limit = 5): number[] {
  const rows = db
    .prepare(
      `SELECT o.id FROM offers o JOIN needs n ON n.id = o.need_id
       WHERE o.source = 'auto' AND o.monitoring = 1 AND o.status != 'archived'
         AND n.cancelled = 0 AND n.monitoring_paused = 0
         AND (SELECT COALESCE(SUM(p.quantity),0) FROM purchases p WHERE p.need_id = n.id) < n.quantity
         AND (o.next_check_at IS NULL OR o.next_check_at <= ?)
         AND (o.locked_until IS NULL OR o.locked_until < ?)
       ORDER BY o.next_check_at LIMIT ?`,
    )
    .all(now.toISOString(), now.toISOString(), limit) as { id: number }[]
  return rows.map((r) => r.id)
}

export function startWorker(
  db: DB,
  deps: CollectDeps & { telegram?: TelegramApi; backupDir?: string; backupKeep?: number },
  tickMs = 30_000,
) {
  let running = false
  let lastBackupDay = ''
  const tick = async () => {
    if (running) return
    running = true
    try {
      const now = new Date()
      for (const id of dueOffers(db, now)) {
        const lock = db
          .prepare('UPDATE offers SET locked_until = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)')
          .run(new Date(now.getTime() + 5 * 60_000).toISOString(), id, now.toISOString())
        if (lock.changes === 0) continue
        const r = await collectOffer(db, id, deps)
        if (!r.ok) console.warn(`[coleta] oferta ${id}: ${r.error}`)
      }
      await processOutbox(db, deps.telegram ?? realTelegramApi)
      // backup diário com retenção
      const day = nowIso().slice(0, 10)
      if (deps.backupDir && day !== lastBackupDay && new Date().getUTCHours() >= 6) {
        lastBackupDay = day
        const existing = await import('node:fs').then((fs) =>
          fs.existsSync(deps.backupDir!) ? fs.readdirSync(deps.backupDir!).some((f) => f.includes(day) && f.includes('diario')) : false,
        )
        if (!existing) {
          snapshot(db, deps.backupDir, 'diario')
          pruneBackups(deps.backupDir, deps.backupKeep ?? 14)
        }
      }
    } catch (e) {
      console.error('[worker] erro no ciclo:', (e as Error).message)
    } finally {
      running = false
    }
  }
  const handle = setInterval(tick, tickMs)
  setTimeout(tick, 2_000)
  return {
    stop: async () => {
      clearInterval(handle)
      // encerramento gracioso: espera o ciclo atual terminar
      for (let i = 0; i < 60 && running; i++) await new Promise((r) => setTimeout(r, 500))
    },
    tick,
  }
}
