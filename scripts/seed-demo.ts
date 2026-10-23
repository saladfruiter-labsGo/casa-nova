/**
 * Dados de DEMONSTRAÇÃO, fictícios, para validar a interface.
 * Uso: DATA_DIR=./demo-data npm run seed:demo   (nunca rode contra o banco de produção)
 */
import path from 'node:path'
import { openDb, setSetting } from '../server/db.ts'
import { addManualObservation, createManualOffer } from '../server/core.ts'

const dir = process.env.DATA_DIR ?? path.resolve('demo-data')
if (!/demo/i.test(dir)) {
  console.error('Por segurança, DATA_DIR precisa conter "demo".')
  process.exit(1)
}
const db = openDb(path.join(dir, 'casa-nova.db'))
const now = Date.now()
const daysAgo = (d: number) => new Date(now - d * 86400_000)

const room = (name: string, budget: number) => Number(db.prepare('INSERT INTO rooms(name, budget_cents) VALUES (?,?)').run(name, budget).lastInsertRowid)
const cat = (name: string) => Number(db.prepare('INSERT INTO categories(name) VALUES (?)').run(name).lastInsertRowid)
const cozinha = room('Cozinha', 900000)
const sala = room('Sala', 600000)
const quarto = room('Quarto', 400000)
const eletro = cat('Eletrodomésticos')
const moveis = cat('Móveis')
const ilum = cat('Iluminação')

function need(o: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const keys = Object.keys(o)
  return Number(
    db
      .prepare(`INSERT INTO needs(${keys.join(',')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(',')}, ?, ?)`)
      .run(...(Object.values(o) as (string | number | null)[]), ts, ts).lastInsertRowid,
  )
}
function history(needId: number, store: string, label: string, prices: [number, number][], extra: { shipping?: number | null } = {}) {
  const offer = createManualOffer(db, needId, { store, store_label: label })
  for (const [d, cents] of prices)
    addManualObservation(
      db,
      offer,
      {
        price_cash_cents: cents,
        price_installment_total_cents: Math.round(cents * 1.08),
        installments: 10,
        shipping_cents: extra.shipping ?? null,
        shipping_known: extra.shipping !== undefined && extra.shipping !== null,
        availability: 'in_stock',
        seller: label,
        conditional: false,
        conditional_note: null,
        note: 'dado fictício de demonstração',
      },
      daysAgo(d),
    )
  return offer
}

const geladeira = need({ title: '[Exemplo] Geladeira frost free', room_id: cozinha, category_id: eletro, priority: 1, brand: 'Marca Exemplo', model: 'GX-400', voltage: '220V', color: 'Inox', target_price_cents: 330000, desired_date: '2026-12-15' })
history(geladeira, 'outra', 'Loja Exemplo A', [[2.5, 359900], [2, 349900], [1.5, 349900], [1, 339900], [0.2, 324900]])
history(geladeira, 'outra', 'Loja Exemplo B', [[2.2, 369900], [1.2, 354900], [0.3, 345000]])

const micro = need({ title: '[Exemplo] Micro-ondas 30 L', room_id: cozinha, category_id: eletro, priority: 2, voltage: '220V', target_price_cents: 60000 })
history(micro, 'outra', 'Loja Exemplo A', [[2, 79900], [1, 74900], [0.2, 72900]])

const sofa = need({ title: '[Exemplo] Sofá 3 lugares retrátil', room_id: sala, category_id: moveis, priority: 2, color: 'Cinza', dimensions: '210 × 100 × 95 cm', target_price_cents: 250000, target_mode: 'total' })
history(sofa, 'outra', 'Loja Exemplo C', [[1, 279900], [0.1, 269900]])

need({ title: '[Exemplo] Rack para TV', room_id: sala, category_id: moveis, priority: 3 })

const lum = need({ title: '[Exemplo] Luminária de teto LED', room_id: quarto, category_id: ilum, priority: 2, quantity: 3, target_price_cents: 9000 })
const lo = history(lum, 'outra', 'Loja Exemplo B', [[1, 9990], [0.1, 9490]])
db.prepare('INSERT INTO purchases(need_id, offer_id, store_label, quantity, unit_price_cents, shipping_cents, purchased_at, delivered_at) VALUES (?,?,?,?,?,?,?,?)').run(
  lum, lo, 'Loja Exemplo B', 1, 9490, 1500, daysAgo(3).toISOString().slice(0, 10), daysAgo(1).toISOString().slice(0, 10),
)

const cama = need({ title: '[Exemplo] Cama box casal', room_id: quarto, category_id: moveis, priority: 1 })
const co = history(cama, 'outra', 'Loja Exemplo A', [[4, 129900]])
db.prepare('INSERT INTO purchases(need_id, offer_id, store_label, quantity, unit_price_cents, shipping_cents, purchased_at) VALUES (?,?,?,?,?,?,?)').run(
  cama, co, 'Loja Exemplo A', 1, 124900, 0, daysAgo(2).toISOString().slice(0, 10),
)
setSetting(db, 'cep', '01001000')
console.log('Dados de demonstração criados em', dir)
