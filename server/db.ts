import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export type DB = DatabaseSync

/**
 * Migrações versionadas via PRAGMA user_version.
 * Regra: só adicionar novas entradas ao final; nunca editar uma migração publicada.
 * Valores monetários em centavos inteiros; datas em ISO-8601 UTC (com timezone).
 */
export const MIGRATIONS: string[] = [
  // 1 — esquema inicial
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    budget_cents INTEGER,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  -- necessidade + produto escolhido (MVP: um produto por necessidade)
  CREATE TABLE needs (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    desired_date TEXT,
    budget_cents INTEGER,
    notes TEXT,
    brand TEXT, model TEXT, ean TEXT, voltage TEXT, color TEXT, dimensions TEXT, variant_notes TEXT,
    image_url TEXT,
    target_price_cents INTEGER,
    target_mode TEXT NOT NULL DEFAULT 'item' CHECK (target_mode IN ('item','total')),
    price_basis TEXT NOT NULL DEFAULT 'cash' CHECK (price_basis IN ('cash','installment')),
    accept_conditional INTEGER NOT NULL DEFAULT 0,
    alert_drop_pct REAL,
    alert_restock INTEGER NOT NULL DEFAULT 0,
    monitoring_paused INTEGER NOT NULL DEFAULT 0,
    cancelled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE offers (
    id INTEGER PRIMARY KEY,
    need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
    store TEXT NOT NULL,
    store_label TEXT,
    url TEXT,
    external_id TEXT,
    seller TEXT,
    title TEXT,
    image_url TEXT,
    source TEXT NOT NULL CHECK (source IN ('auto','manual')),
    monitoring INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','active','stale','unavailable','needs_attention','manual','archived')),
    shipping_cents_manual INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT,
    last_valid_at TEXT,
    last_error TEXT,
    next_check_at TEXT,
    locked_until TEXT,
    last_manual_check_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX offers_need ON offers(need_id);
  CREATE INDEX offers_due ON offers(monitoring, next_check_at);

  -- observação de preço: imutável, nunca sobrescrita
  CREATE TABLE observations (
    id INTEGER PRIMARY KEY,
    offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('auto','manual')),
    price_cash_cents INTEGER,
    price_installment_total_cents INTEGER,
    installments INTEGER,
    shipping_cents INTEGER,
    shipping_known INTEGER NOT NULL DEFAULT 0,
    availability TEXT NOT NULL CHECK (availability IN ('in_stock','out_of_stock','unknown')),
    seller TEXT,
    conditional INTEGER NOT NULL DEFAULT 0,
    conditional_note TEXT,
    cep TEXT,
    external_id TEXT,
    note TEXT
  );
  CREATE INDEX observations_offer ON observations(offer_id, observed_at);

  CREATE TABLE fetch_log (
    id INTEGER PRIMARY KEY,
    offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    http_status INTEGER,
    duration_ms INTEGER,
    error TEXT
  );

  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY,
    need_id INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
    offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
    store_label TEXT,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    shipping_cents INTEGER NOT NULL DEFAULT 0,
    purchased_at TEXT NOT NULL,
    delivered_at TEXT,
    notes TEXT
  );

  -- estado das condições de alerta (disparo por borda + cooldown)
  CREATE TABLE alert_state (
    key TEXT PRIMARY KEY,
    active INTEGER NOT NULL,
    last_sent_at TEXT,
    last_value_cents INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    need_id INTEGER REFERENCES needs(id) ON DELETE CASCADE,
    offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );

  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function openDb(file: string, opts: { backupDir?: string } = {}): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db, file, opts.backupDir)
  return db
}

export function getSchemaVersion(db: DB): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
}

export function migrate(db: DB, file = ':memory:', backupDir?: string) {
  const current = getSchemaVersion(db)
  if (current > SCHEMA_VERSION) {
    // Banco mais novo que o código: rollback de imagem não desfaz migração.
    throw new Error(
      `Esquema do banco (v${current}) é mais novo que esta versão do app (v${SCHEMA_VERSION}). ` +
        'Recusando iniciar para não corromper dados. Restaure a versão anterior do app ou um backup compatível.',
    )
  }
  if (current === SCHEMA_VERSION) return
  // Snapshot antes de migrar um banco existente
  if (current > 0 && file !== ':memory:' && backupDir) {
    snapshot(db, backupDir, `pre-migracao-v${current}-para-v${SCHEMA_VERSION}`)
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

export function snapshot(db: DB, backupDir: string, label = 'manual'): string {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safe = label.replace(/[^a-z0-9-]/gi, '_')
  const dest = path.join(backupDir, `casa-nova-${stamp}-${safe}.db`)
  db.prepare('VACUUM INTO ?').run(dest)
  // verificação: abrir e checar integridade
  const check = new DatabaseSync(dest, { readOnly: true })
  const r = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
  check.close()
  if (r.integrity_check !== 'ok') throw new Error('Backup gerado falhou na verificação de integridade')
  return dest
}

export function pruneBackups(backupDir: string, keep: number) {
  if (!fs.existsSync(backupDir)) return
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('casa-nova-') && f.endsWith('.db'))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(backupDir, f))
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const nowIso = (d: Date = new Date()) => d.toISOString()

export function getSetting(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return r ? r.value : null
}
export function setSetting(db: DB, key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
