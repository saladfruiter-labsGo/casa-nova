import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UrlRejected, assertPublicHost, isPrivateIp, parseStoreUrl } from '../stores.ts'
import { CollectError, createSafeFetcher } from '../fetcher.ts'

test('URL: aceita lojas da lista, inclusive subdomínio', () => {
  assert.equal(parseStoreUrl('https://site.fastshop.com.br/x/p').store.key, 'fastshop')
  assert.equal(parseStoreUrl('https://www.amazon.com.br/dp/B08JNM2R8T').store.key, 'amazon')
  assert.equal(parseStoreUrl('https://produto.mercadolivre.com.br/MLB-1').store.key, 'mercadolivre')
})

test('URL maliciosa: esquema, IP, credenciais, porta e domínio parecido são bloqueados', () => {
  for (const u of [
    'http://www.leroymerlin.com.br/x',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://user:pass@www.leroymerlin.com.br/x',
    'https://www.leroymerlin.com.br:8443/x',
    'https://leroymerlin.com.br.evil.com/x',
    'https://evilleroymerlin.com.br/x',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => parseStoreUrl(u), UrlRejected, u)
  }
})

test('IPs privados, loopback, link-local e CGNAT/Tailscale são considerados privados', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.90', '172.16.5.4', '169.254.169.254', '100.91.145.112', '::1', 'fd00::1', '::ffff:10.0.0.1'])
    assert.ok(isPrivateIp(ip), ip)
  for (const ip of ['8.8.8.8', '200.147.3.157', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip)
})

test('DNS que resolve para rede privada é bloqueado', async () => {
  await assert.rejects(assertPublicHost('www.leroymerlin.com.br', async () => ['10.0.0.5']), UrlRejected)
  await assertPublicHost('www.leroymerlin.com.br', async () => ['200.1.2.3'])
})

test('redirecionamento para rede privada ou domínio fora da lista é bloqueado', async () => {
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () =>
      new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } })) as typeof fetch
    const f = createSafeFetcher(async () => ['200.1.2.3'], false)
    await assert.rejects(f(new URL('https://www.leroymerlin.com.br/x')), (e: CollectError) => e.kind === 'rejected')

    globalThis.fetch = (async () => new Response(null, { status: 301, headers: { location: 'https://evil.example.com/' } })) as typeof fetch
    await assert.rejects(f(new URL('https://www.leroymerlin.com.br/x')), (e: CollectError) => e.kind === 'rejected')

    // destino da lista, mas DNS aponta para a rede interna
    globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: 'https://www.carrefour.com.br/y' } })) as typeof fetch
    const f2 = createSafeFetcher(async (host) => (host.includes('carrefour') ? ['192.168.1.1'] : ['200.1.2.3']), false)
    await assert.rejects(f2(new URL('https://www.leroymerlin.com.br/x')), (e: CollectError) => e.kind === 'rejected')
  } finally {
    globalThis.fetch = realFetch
  }
})
