/**
 * Utilitário de linha de comando para uso dentro do container (pelo atualizador do TheVault).
 *   tsx server/cli.ts backup <rótulo>   → snapshot verificado do banco
 *   tsx server/cli.ts notify "<texto>"  → envia mensagem ao chat vinculado do Telegram
 *   tsx server/cli.ts hash-password     → lê a senha do stdin e imprime APP_PASSWORD_HASH
 */
import 'dotenv/config'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getSetting, snapshot } from './db.ts'
import { hashPassword } from './auth.ts'

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data')
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.resolve('backups')
const [cmd, arg] = process.argv.slice(2)

async function main() {
  if (cmd === 'hash-password') {
    const chunks: Buffer[] = []
    for await (const c of process.stdin) chunks.push(c as Buffer)
    const pw = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
    if (pw.length < 8) throw new Error('Senha precisa ter pelo menos 8 caracteres')
    console.log(hashPassword(pw))
    return
  }
  // abre sem migrar: o CLI nunca altera o esquema
  const db = new DatabaseSync(path.join(DATA_DIR, 'casa-nova.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  if (cmd === 'backup') {
    console.log(snapshot(db, BACKUP_DIR, arg || 'cli'))
  } else if (cmd === 'notify') {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chat = process.env.TELEGRAM_CHAT_ID || getSetting(db, 'telegram_chat_id')
    if (!token || !chat) throw new Error('Telegram não configurado')
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(arg ?? '').slice(0, 4000) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) throw new Error(`Telegram respondeu HTTP ${r.status}`)
    console.log('enviado')
  } else {
    throw new Error('Uso: cli.ts backup <rótulo> | notify "<texto>" | hash-password')
  }
  db.close()
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
