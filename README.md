# Casa Nova

App web pessoal para organizar as compras da mudança: produtos por cômodo e categoria, ofertas em várias lojas, histórico de preços, preço desejado e alertas (central + Telegram).

![stack](https://img.shields.io/badge/React-18-61DAFB) ![stack](https://img.shields.io/badge/Hono-4-8A5FE8) ![stack](https://img.shields.io/badge/SQLite-node%3Asqlite-044444) ![node](https://img.shields.io/badge/Node-24-339933)

## O que faz

- **Lista da mudança:** produto (marca, modelo, voltagem, cor, EAN), cômodo, categoria, quantidade, prioridade, data e orçamento. Estados: planejado → monitorando → comprado → entregue (ou cancelado). Compra parcial mantém o saldo pendente.
- **Ofertas:** cole o link do produto. Leroy Merlin, Carrefour e Fast Shop são lidas automaticamente; Amazon parcialmente; Casas Bahia, Pontofrio, Magalu e Mercado Livre bloqueiam leitura automática e ficam com **preço manual** (detalhes em [docs/prova-de-coleta.md](docs/prova-de-coleta.md)).
- **Preço certo:** à vista e parcelado são séries separadas; frete desconhecido nunca vira zero; vendedor e variante são registrados; troca de variante na loja suspende a oferta em vez de gerar falso desconto.
- **Alertas:** preço desejado (por unidade ou com frete), queda percentual vs. média dos últimos 30 dias da mesma loja/vendedor, volta ao estoque. Disparo na entrada da condição, cooldown de 24 h, reenvio só com nova queda ≥ 5 %. Outbox persistente com deduplicação.
- **Painel:** gasto real separado da estimativa; itens sem cotação aparecem como pendentes, nunca como R$ 0.
- **Segurança:** login por senha (scrypt, sessão HttpOnly/SameSite=Strict, limite de tentativas), proteção CSRF por origem, coleta só para domínios das lojas com bloqueio de IP privado e revalidação de redirecionamentos (anti-SSRF), token do Telegram só por variável de ambiente e removido de logs.
- **Dados:** exportação CSV (produtos, ofertas, histórico, compras), backup diário verificado com retenção, backup antes de migrações.

## Stack

Vite + React 18 + TypeScript + Tailwind · Hono (Node 24, `tsx`) · SQLite nativo do Node (`node:sqlite`, WAL) · worker de coleta no mesmo processo com agenda persistente no banco · Docker/Compose · imagens no GHCR.

## Desenvolvimento

```bash
npm install
APP_PASSWORD=uma-senha-local npm run dev        # API :3010 + Vite :5173
npm test                                        # 37 testes (regras de alerta, adaptadores com dados reais, API, segurança)
npm run typecheck && npm run build
DATA_DIR=./demo-data npm run seed:demo          # dados FICTÍCIOS de demonstração
```

Variáveis: veja [.env.example](.env.example).

## Estrutura

```
server/
  app.ts          rotas da API (Hono)
  core.ts         coleta, ofertas, observações, regras de negócio
  alerts.ts       motor de alertas (função pura, testada)
  adapters/       JSON-LD, VTEX, Amazon
  fetcher.ts      HTTP seguro (anti-SSRF, limite por domínio, timeouts)
  notify.ts       Telegram + outbox
  worker.ts       agenda persistente de coleta e envio, backup diário
  db.ts           esquema, migrações versionadas, snapshots
  cli.ts          backup / notify / hash-password (usado pelo atualizador)
src/              interface (Visão geral, Produtos, Compras, Alertas, Configurações)
deploy/           atualizador automático do TheVault
docs/             prova de coleta e guia de implantação
```

## Versões e implantação

Produção (TheVault) só recebe **releases estáveis** `vX.Y.Z`: o workflow *Release* testa e publica a imagem; o atualizador local aplica com backup, verificação de saúde/versão, rollback compatível e aviso no Telegram. Passo a passo em [docs/implantacao-thevault.md](docs/implantacao-thevault.md).

Plano funcional completo: [PLANO.md](PLANO.md).
