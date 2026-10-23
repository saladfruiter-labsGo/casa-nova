# Prova de coleta — 8 lojas candidatas

**Data:** 22/10/2026 · **Origem dos testes:** host do Hermes e TheVault (rede residencial), requisições HTTP simples, 1 por página, com intervalo.
**Regra seguida:** nenhuma tentativa de contornar CAPTCHA, verificação de conta, bloqueio anti-bot ou login. Loja que recusa acesso fica com **preço manual**.

| Loja | Status | Método | Preço | Estoque | Vendedor | Frete | Evidência |
|---|---|---|---|---|---|---|---|
| Leroy Merlin | **viável** | JSON-LD `Product/Offer` na página | ✅ | ✅ | ❌ | ❌ | HTTP 200; ex.: luminária Opus ST3065 = R$ 133,00 `InStock`; item sem estoque publica `price: 0` + `OutOfStock` (tratado como indisponível, nunca preço zero) |
| Carrefour | **viável** | JSON-LD `Product/Offer` | ✅ | ✅ | ❌ | ❌ | HTTP 200; micro-ondas Electrolux MI41S = R$ 839,00 `InStock`. A API de catálogo VTEX da loja responde 403 (não usada) |
| Fast Shop | **viável** | API pública de catálogo VTEX (`/api/catalog_system/pub/products/search/{slug}/p`) | ✅ à vista + parcelado | ✅ | ✅ (vários) | ❌ | HTTP 200/206; vendedores separados (ex.: “Coqueluche Casa” R$ 59,88 c/ estoque; “Fast Shop” sem estoque) |
| Amazon BR | **parcial** | HTML da página do produto | ✅ | ✅ | às vezes | ❌ | HTTP 200; preço da caixa de compra R$ 512,05 (o “De” R$ 689,00 é ignorado). Sem dados estruturados; pode pedir CAPTCHA a qualquer momento → vira “Precisa de atenção” |
| Casas Bahia | **indisponível** | — | manual | manual | manual | manual | HTTP 403 (anti-bot) a partir dos dois hosts |
| Pontofrio | **indisponível** | — | manual | manual | manual | manual | HTTP 403 (anti-bot) a partir dos dois hosts |
| Magalu | **indisponível** | — | manual | manual | manual | manual | HTTP 403 a partir dos dois hosts |
| Mercado Livre | **indisponível** | — | manual | manual | manual | manual | Página redireciona para `account-verification`; API `api.mercadolibre.com/items` responde 403 sem credencial OAuth |

## Limitações conhecidas

- **Frete:** nenhuma das lojas expõe frete sem carrinho/CEP. O app trata frete como **desconhecido** e permite informá-lo por oferta. Alertas de “produto + frete” só disparam com frete conhecido.
- **Pix/descontos de pagamento:** Leroy e Carrefour publicam um único preço; Fast Shop informa preço e parcelamento sem juros. Descontos de Pix aplicados só no checkout não são vistos.
- **Mercado Livre:** pode virar viável criando um app gratuito no portal de desenvolvedores do ML (OAuth). Não implementado: depende de credencial sua.
- **Estabilidade:** a amostra é de um dia. O plano recomenda observar por pelo menos uma semana; o painel “Lojas” e o status de cada oferta (Atualizado / Desatualizado / Precisa de atenção) mostram a saúde real ao longo do tempo.
- **Cadência:** padrão a cada 6 h (+ até 20 % de variação aleatória), 15 s mínimos entre requisições ao mesmo domínio, backoff de 1 h → 3 h → 24 h em falhas, suspensão com aviso após 3 falhas.

## Testes automatizados com dados reais

Recortes das respostas reais estão em `server/test/fixtures/` (somente os blocos JSON-LD, o JSON VTEX reduzido e trechos do HTML da Amazon) e são usados em `server/test/adapters.test.ts`.
