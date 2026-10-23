import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './db.ts'
import { createApp } from './app.ts'
import { resolvePasswordHash } from './auth.ts'
import { createSafeFetcher } from './fetcher.ts'
import { startWorker } from './worker.ts'

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data')
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.resolve('backups')
const PORT = Number(process.env.PORT ?? 3010)
const VERSION = process.env.APP_VERSION ?? JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version

const passwordHash = resolvePasswordHash()
if (!passwordHash) {
  console.error('Defina APP_PASSWORD (mín. 8 caracteres) ou APP_PASSWORD_HASH no ambiente. Recusando iniciar sem autenticação.')
  process.exit(1)
}

const db = openDb(path.join(DATA_DIR, 'casa-nova.db'), { backupDir: BACKUP_DIR })
const fetcher = createSafeFetcher()
const app = createApp({
  db,
  fetcher,
  passwordHash,
  version: VERSION,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  backupDir: BACKUP_DIR,
})

// Frontend estático (build do Vite)
const dist = path.resolve('dist')
if (fs.existsSync(dist)) {
  app.use('/assets/*', serveStatic({ root: './dist' }))
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', (c) => c.html(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')))
}

const worker = process.env.WORKER_DISABLED === 'true' ? null : startWorker(db, { fetcher, backupDir: BACKUP_DIR, backupKeep: Number(process.env.BACKUP_KEEP ?? 14) })

const server = serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST ?? '0.0.0.0' }, (info) =>
  console.log(`Casa Nova v${VERSION} em http://${info.address}:${info.port} (dados: ${DATA_DIR})`),
)

async function shutdown(sig: string) {
  console.log(`Recebido ${sig}, encerrando com calma…`)
  server.close()
  await worker?.stop()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
