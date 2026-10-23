import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatBRL, toCents } from '../money.ts'
import { amazonAsin, parseAmazon, parseJsonLd, parseVtex, pickSellerOffer, vtexSlug } from '../adapters/index.ts'
import { CollectError } from '../fetcher.ts'

const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

test('toCents: formatos brasileiros e internacionais, sem ponto flutuante', () => {
  assert.equal(toCents('R$ 1.234,56'), 123456)
  assert.equal(toCents('1234,5'), 123450)
  assert.equal(toCents('1234.56'), 123456)
  assert.equal(toCents('1.234'), 123400)
  assert.equal(toCents('1,234.56'), 123456)
  assert.equal(toCents(0.1 + 0.2), 30)
  assert.equal(toCents(19.99), 1999)
  assert.equal(toCents('R$\u00a0512,05'), 51205)
  assert.equal(toCents('abc'), null)
  assert.equal(toCents(-5), null)
  assert.equal(toCents('12,345'), null)
  assert.equal(formatBRL(123456), 'R$ 1.234,56')
  assert.equal(formatBRL(5), 'R$ 0,05')
  assert.equal(formatBRL(null), '—')
})

test('JSON-LD (Leroy Merlin real): em estoque', () => {
  const c = parseJsonLd(fx('leroy-instock.html'))
  assert.match(c.title!, /Luminária/)
  assert.equal(c.externalId, '1572132677')
  assert.equal(c.offers[0].availability, 'in_stock')
  assert.equal(c.offers[0].priceCashCents, 13300)
})

test('JSON-LD: preço 0 com OutOfStock vira indisponível, nunca preço zero', () => {
  const c = parseJsonLd(fx('leroy-outofstock.html'))
  assert.equal(c.offers[0].availability, 'out_of_stock')
  assert.equal(c.offers[0].priceCashCents, null)
})

test('JSON-LD (Carrefour real): preço e EAN', () => {
  const c = parseJsonLd(fx('carrefour-instock.html'))
  assert.equal(c.offers[0].availability, 'in_stock')
  assert.ok(c.offers[0].priceCashCents! > 0)
  assert.ok(c.title)
})

test('JSON-LD ausente gera erro de leitura (não um preço)', () => {
  assert.throws(() => parseJsonLd('<html></html>'), CollectError)
})

test('VTEX (Fast Shop real): vendedores separados; vendedor sem estoque não vira preço', () => {
  const c = parseVtex(fx('fastshop-vtex.json'), null)
  assert.equal(c.externalId, '91487')
  const fast = c.offers.find((o) => o.seller === 'Fast Shop')!
  assert.equal(fast.availability, 'out_of_stock')
  assert.equal(fast.priceCashCents, null)
  const best = pickSellerOffer(c, null)!
  assert.equal(best.seller, 'Coqueluche Casa')
  assert.equal(best.priceCashCents, 5988)
  // vendedor travado não troca silenciosamente por outro
  assert.equal(pickSellerOffer(c, 'Fast Shop')!.availability, 'out_of_stock')
})

test('VTEX: SKU inexistente acusa troca de variante', () => {
  assert.throws(() => parseVtex(fx('fastshop-vtex.json'), '999999'), (e: CollectError) => e.kind === 'variant_mismatch')
  assert.equal(vtexSlug(new URL('https://site.fastshop.com.br/geladeira-x-123/p')), 'geladeira-x-123')
  assert.throws(() => vtexSlug(new URL('https://site.fastshop.com.br/eletrodomesticos')))
})

test('Amazon (recorte real): preço da caixa de compra, não o "De"', () => {
  const c = parseAmazon(fx('amazon.html'), 'B08JNM2R8T')
  assert.equal(c.offers[0].priceCashCents, 51205)
  assert.equal(c.offers[0].availability, 'in_stock')
  assert.match(c.title!, /Panasonic/)
  assert.equal(amazonAsin(new URL('https://www.amazon.com.br/x/dp/B08JNM2R8T?th=1')), 'B08JNM2R8T')
})

test('Amazon: CAPTCHA vira erro, sem preço', () => {
  assert.throws(
    () => parseAmazon('<form action="/errors/validateCaptcha">Digite os caracteres que você vê</form>', 'X'),
    (e: CollectError) => e.kind === 'captcha',
  )
})
