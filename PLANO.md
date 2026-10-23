# Casa Nova — plano funcional e opções de implementação

## Estado e objetivo

**Estado (22/10/2026):** etapas 2–4 executadas e publicadas no GitHub (`saladfruiter-labsGo/casa-nova`); etapa 5 (implantação no TheVault) **aguardando liberação**. Ver “Execução” ao final.

**Documento canônico:** `/home/hermes/projects/compras/PLANO.md`.

Construir uma aplicação web pessoal para organizar as compras da mudança, cadastrar produtos específicos por grupos, acompanhar ofertas e histórico de preços e receber alertas configuráveis.

Contexto consultado: `IDEA.md` no projeto `/home/hermes/projects/compras` e ideia existente em `RO/Projetos/Shelf/Ideias.md` no Obsidian. Ambos reforçam cadastro, avaliação de preços e avisos de promoção. Não existe código de aplicação identificado na inspeção inicial.

Confirmado pelo pedido: aplicação web, produtos específicos, categorias/grupos, monitoramento em lojas e alertas. Também confirmado: uso individual, alertas pelo Telegram, hospedagem no TheVault via Docker Compose e atualização automática quando a versão no GitHub mudar. Demais recomendações ainda não aprovadas. Premissas: compras no Brasil e valores em BRL.

## Abordagem recomendada

Aplicação própria pequena, com monitoramento híbrido: URLs informadas pelo usuário, adaptadores para lojas validadas e lançamento manual como alternativa. Avaliar as oito lojas candidatas indicadas pelo usuário, com implementação em ondas conforme viabilidade, sem prometer suporte universal. Pesquisa automática de produtos em outras lojas é uma segunda etapa, separada do monitoramento de anúncios conhecidos.

O desafio principal não é o cadastro: é obter preços comparáveis, da variante correta, de forma repetível e respeitando os termos das fontes. Validar essa parte antes de desenvolver a aplicação inteira.

## Lojas candidatas

1. Casas Bahia
2. Mercado Livre
3. Fast Shop
4. magalu
5. Leroy Merlin
6. Amazon BR
7. Pontofrio
8. Carrefour

Lista indicada pelo usuário para avaliação, não suporte já validado. Registrar por loja: domínio confirmado, URLs reais de teste, método permitido de coleta, necessidade de autenticação, cobertura de preço/estoque/frete e resultado. Status possíveis: pendente, viável, parcial ou indisponível. Não retirar lojas silenciosamente quando a integração falhar.

**Confirmado pelo usuário:** a loja é Fast Shop. Os domínios e anúncios serão validados pelos links reais na prova de coleta.

## Alternativas

| Opção | Vantagens | Limitações | Quando escolher |
|---|---|---|---|
| Lista/planilha e alertas em comparadores existentes | Pouco desenvolvimento; útil para validar o processo | Organização e histórico fragmentados; cobertura e integração dependem dos serviços | Solução imediata, sem construir sistema |
| App próprio e serviço externo de dados | Menor esforço para manter coleta quando o provedor cobre as lojas | Custo recorrente, limites e dependência; cobertura brasileira e licença precisam ser verificadas | Quando confiabilidade operacional justifica pagar |
| App próprio e adaptadores seletivos, com fallback manual | Controle de categorias, orçamento e regras; expansão gradual | Manutenção de integrações e possíveis bloqueios | **Melhor equilíbrio para este projeto** |
| Coletor universal baseado em navegador/IA | Flexibilidade aparente | Fragilidade, custo, lentidão, erros de variante e bloqueios | Não recomendar como fundação |

Não foram verificadas ofertas comerciais nem APIs específicas; seleção de fornecedores depende das lojas e do orçamento aprovados.

## Fluxo de uso

1. Criar grupos por cômodo e categorias por tipo: Cozinha / Eletrodomésticos, Sala / Móveis, Quarto / Iluminação. Tags complementam, sem confundir cômodo com categoria.
2. Cadastrar necessidade, quantidade, prioridade e data desejada de compra.
3. Vincular um produto exato: marca, modelo, código/EAN quando disponível, voltagem, dimensão, cor e demais variantes relevantes.
4. Adicionar URLs de anúncios equivalentes em lojas diferentes; confirmar os dados importados.
5. Definir limite de preço, condição de pagamento aceita, vendedores aceitos e CEP de entrega quando necessário.
6. Consultar painel com melhor oferta válida, histórico e situação do monitoramento.
7. Receber alerta e abrir a oferta para conferência e compra manual.
8. Registrar compra, preço efetivamente pago, entrega e conclusão; pausar monitoramento quando a quantidade necessária estiver comprada.

Separar necessidade de produto e oferta. Exemplo: “geladeira para cozinha” é a necessidade; um modelo de uma voltagem é o produto; cada anúncio/vendedor é uma oferta. No MVP, uma necessidade pode ter apenas um produto escolhido; alternativas entram posteriormente.

## Escopo do MVP

### Organização
- CRUD de categorias, cômodos e produtos, com busca e filtros.
- Quantidade, prioridade, observações, orçamento e data desejada.
- Estados: planejado, monitorando, comprado, entregue e cancelado. Compras parciais não concluem a necessidade inteira.
- Produtos comprados mantêm histórico; monitoramento pode ser pausado/retomado.

### Ofertas e preços
- Várias URLs por produto; loja e vendedor distinguidos em marketplaces.
- Preço à vista/Pix separado de preço total parcelado, número de parcelas e condições de cupom/clube.
- Preço do item, frete, taxas obrigatórias conhecidas, total e disponibilidade separados.
- Frete desconhecido não significa frete zero. Total desconhecido não participa automaticamente de uma regra de custo final.
- CEP e contexto de pagamento associados às observações comparáveis.
- Histórico por oferta e série comparável entre ofertas; mudanças de vendedor/variante não podem gerar descontos artificiais.
- Identificação da fonte automática ou manual, horário da coleta e última leitura válida.
- Indicador claro: ativo, atrasado, indisponível ou requer intervenção.

### Alertas
- Prioridade do MVP: preço-alvo atingido; opcionais, queda percentual e retorno ao estoque.
- Preço-alvo pode ser por item ou custo final, explicitamente escolhido. Respeitar quantidade e disponibilidade.
- Queda percentual usa uma referência explícita e comparável, não o “de” anunciado pela loja. Mínima histórica significa apenas mínima desde o início do acompanhamento ou na janela selecionada.
- Alertar na entrada da condição, não em toda coleta. Sugestão: cooldown de 24 horas e reenvio somente após nova condição ou nova queda relevante configurada.
- Central de alertas interna e **Telegram como canal externo confirmado**. Vincular apenas o chat autorizado do proprietário e verificar recebimento real. Token do bot por mecanismo seguro, fora do repositório e dos logs. E-mail e WhatsApp fora do MVP.
- Mensagem com produto/variante, vendedor, preço e condições, frete conhecido/desconhecido, estoque, horário e link. Nenhuma garantia de reserva ou preço no checkout.

### Painel
- Por cômodo/categoria: orçamento, estimativa restante, gasto real e itens pendentes/comprados/entregues.
- Próximas compras por prioridade e prazo; ofertas que atingiram o alvo.
- Separar gasto realizado de estimativa atual; itens sem preço válido aparecem como pendentes de cotação, nunca como zero.
- Mostrar diferença entre orçamento e estimativa sem chamá-la de “economia” realizada.

## Interface e experiência de uso

**Requisito confirmado:** a interface deve ser bem intuitiva e moderna. As diretrizes abaixo tornam esse requisito verificável; a identidade visual final será validada em protótipo antes da implementação completa.

- Visual limpo, tipografia legível, espaçamento consistente e hierarquia clara; evitar excesso de indicadores, cores e elementos decorativos.
- Interface em português, valores em reais e termos cotidianos: “Adicionar produto”, “Preço desejado”, “Marcar como comprado”. Não expor jargão técnico de coleta ao usuário.
- Navegação principal enxuta: Visão geral, Produtos, Compras e Alertas; configurações em área secundária. Cômodos e categorias como filtros, não menus duplicados.
- Cadastro guiado: colar link ou cadastrar manualmente → confirmar produto e variante → escolher cômodo/categoria → definir preço-alvo. Campos avançados recolhidos; importação automática sempre revisável e alternativa manual sempre disponível.
- Lista visual com foto quando disponível, nome/modelo, melhor preço válido, preço-alvo, condição de pagamento e estado do monitoramento; filtros por cômodo, categoria, prioridade e situação. Preservar filtros ao abrir um produto e voltar.
- Detalhe do produto com ofertas comparáveis e histórico; deixar frete desconhecido, variante, vendedor e última atualização visíveis perto do preço, sem depender de tooltip.
- Painel orientado à decisão: o que comprar primeiro, quais itens atingiram o alvo e quanto falta gastar. Explicar estimativas incompletas automaticamente.
- Responsividade real: navegação e comparação de ofertas adaptadas ao celular, sem simplesmente encolher uma tabela de desktop. Ações principais acessíveis por toque.
- Estados vazios com orientação e ação clara; feedback de salvamento, carregamento e erro; falhas preservam dados digitados e oferecem nova tentativa. Animações discretas respeitam redução de movimento.
- Acessibilidade: navegação por teclado, foco visível, rótulos nos campos, contraste compatível com WCAG AA e estados indicados por texto/ícone, não apenas cor.
- Tema claro/escuro como proposta, respeitando preferência do sistema. Paleta, componentes e densidade visual serão escolhidos no protótipo, não presumidos como aprovados.

### Validação de UX antes de concluir o MVP

Criar protótipo navegável das telas principais em desktop e celular. Validar com o usuário o fluxo de cadastrar produto, vincular oferta, definir alerta, filtrar por cômodo e registrar compra, sem precisar explicar onde clicar. Dados de demonstração devem estar identificados como fictícios.

Critérios de aceite: concluir esses fluxos sem bloqueios ou perda de dados; ausência de rolagem horizontal na página em tela estreita; controles acessíveis por teclado; condições do preço e erros compreensíveis; aprovação visual do usuário. A aparência moderna não substitui clareza nem precisão dos preços.

## Estratégia de monitoramento

Ordem preferencial por loja:
1. API oficial ou feed autorizado, quando disponível e permitido para o uso.
2. Dados públicos estruturados (por exemplo, Product/Offer em JSON-LD), verificando preço, estoque e variante contra a oferta real.
3. Extração de HTML com adaptador específico.
4. Navegador automatizado apenas para fontes permitidas que dependam de JavaScript.
5. Atualização manual ou integração com fornecedor de dados se a fonte não for viável.

Não contornar CAPTCHA, autenticação, paywalls ou controles de acesso. Avaliar termos, políticas e limites das fontes. A presença de dados públicos não basta para presumir licença de coleta.

Cadência sugerida: a cada 6 horas, sujeita a limites da fonte e necessidade do usuário; verificação manual com limite. Distribuir chamadas com jitter, limite por domínio, retentativas limitadas e backoff. Usar tarefas persistentes e processamento idempotente para sobreviver a reinícios.

Uma falha mantém a última leitura válida, marcada como antiga; nunca vira preço zero, promoção ou prova de falta de estoque. Falha recorrente suspende coleta agressiva e sinaliza manutenção. Nenhum monitoramento recorrente deve ser ativado antes de uma coleta inicial válida da oferta exata.

## Arquitetura: infraestrutura confirmada; stack proposta

- Web responsiva/PWA com Next.js e TypeScript; interface adequada a desktop e celular.
- PostgreSQL para produtos, ofertas, observações, compras e alertas.
- Worker separado da interface para coleta e envio, com fila/agendamento persistentes apoiados no banco; evitar Redis inicialmente se não necessário.
- Adaptadores de loja isolados e versionados; HTTP primeiro, Playwright apenas quando necessário.
- Valores monetários em centavos inteiros ou decimal exato, sem ponto flutuante; datas armazenadas com timezone.
- **Hospedagem confirmada no TheVault, via Docker Compose**, com atualização automática de versões via GitHub. Nenhuma alteração no servidor nesta etapa. Antes da implantação, diagnosticar recursos, rede, volumes e gestão existente de Compose; obter confirmação para configurações e operações potencialmente disruptivas.
- Acesso privado por rede/VPN como padrão sugerido; autenticação e autorização em todo acesso a dados. Se acesso público for necessário, planejar HTTPS e proteção adicional.
- Alternativa técnica: Django + PostgreSQL + worker, priorizando backend administrativo e desenvolvimento Python em vez de uma interface React mais personalizada. Não misturar duas stacks sem necessidade.

Entidades conceituais: cômodo, categoria, necessidade/produto escolhido, oferta, observação de preço, regra de alerta, entrega de notificação e compra. Cadastro da oferta não deve sobrescrever histórico de observações.

### Atualização automática via GitHub

Requisito confirmado: atualizar automaticamente a aplicação quando a versão no GitHub mudar.

**Proposta a confirmar:** usar publicação de release estável como gatilho, não qualquer commit de desenvolvimento. Repositório, branch e convenção de versões ainda não definidos.

Fluxo recomendado:
1. GitHub Actions executa testes; falhas impedem publicação para produção.
2. Publicar imagens web/worker no GHCR, identificadas por versão, commit e digest imutável; não depender somente de `latest` para recuperação.
3. Atualizador local no TheVault consulta versões por conexão de saída. Não expor Docker/SSH à internet nem executar código de PR no servidor de produção.
4. Bloquear deploys concorrentes, validar Compose, verificar espaço e criar backup antes de migrações; preservar volumes e segredos locais.
5. Baixar imagens e atualizar apenas os serviços deste projeto, com encerramento gracioso do worker e migrações controladas.
6. Verificar saúde de web/banco/worker e ler a versão realmente em execução. Notificar sucesso ou falha no Telegram; manter logs locais se a notificação falhar.
7. Em falha, suspender novas tentativas e retornar à imagem anterior apenas se o esquema do banco for compatível. Rollback de imagem não desfaz migração. Migrações destrutivas ou incompatíveis exigem revisão e confirmação, sem restauração automática que possa perder dados novos.

Antes de ativar, obter aprovação operacional explícita para escopo, gatilho, janela e breve indisponibilidade aceitável. Docker Compose em instância única não garante zero downtime. A automação não pode atualizar outros projetos ou versões principais do banco indiscriminadamente, nem alterar configurações do Unraid.

Definir o mecanismo do atualizador após diagnóstico read-only do TheVault, considerando a gestão de Compose existente. Credenciais de leitura do registro devem ter privilégio mínimo; segredos ficam fora do GitHub/repositório quando não necessários. Não instalar atualizador genérico sem avaliar escopo, migrações e recuperação.

### Segurança e operação
- URLs de lojas são entrada não confiável: validar esquema/domínio, restringir destinos, bloquear endereços privados e metadados e revalidar redirecionamentos para evitar SSRF. Restringir também o tráfego do navegador de coleta.
- Nunca executar instruções presentes em páginas coletadas. IA opcional apenas para sugerir metadados, com confirmação; não decide preço ou variante sozinha.
- Segredos fora do código, logs sem credenciais e coleta mínima de dados pessoais.
- Backup do banco e teste real de restauração; retenção definida antes da implantação.
- Exportação CSV para evitar aprisionamento; registros de coleta e entrega para diagnóstico.
- Notificações por outbox persistente e deduplicação; retentativas não podem produzir spam.

## Etapas e critérios de passagem

### 1. Fechar o recorte
Já definido: oito lojas candidatas (incluindo Fast Shop), Telegram, uso individual, TheVault, Docker Compose, atualização automática via GitHub e interface intuitiva e moderna. Entregável restante: URLs reais, acesso privado/público, política de versões e limite de custo aprovados. Sem esse recorte, não estimar prazo fechado nem prometer cobertura.

### 2. Prova de coleta — antes da interface completa
Entregável: amostra de produtos reais nas lojas aprovadas, com leitura repetida em momentos distintos, confirmação manual de variante, vendedor, pagamento, estoque e frete quando acessível. Sugerido observar por pelo menos uma semana para detectar instabilidade; isso não garante disponibilidade futura.
Aceite: demonstrar coleta real por adaptador e documentar limitações; fonte inviável sai do escopo ou recebe alternativa manual/provedor antes de avançar.

### 3. MVP organizador
Entregável: protótipo navegável validado visualmente, seguido de cadastro, categorias/cômodos, ofertas manuais, prioridades, orçamento, estados e exportação. A aplicação já deve ser útil sem coleta automática.
Aceite: fluxo completo de cadastrar uma compra, comparar ofertas registradas e marcar compra/entrega, preservando histórico e quantidades; cumprir os critérios de UX em desktop e celular.

### 4. Monitoramento e alertas
Entregável: worker persistente, adaptadores aprovados, histórico, saúde das fontes, preço-alvo, central e Telegram.
Aceite: coleta real, alerta de teste recebido no destino, supressão de duplicatas, recuperação após reinício e falhas sem corromper preços.

### 5. Piloto e implantação
Entregável: piloto com a lista real da mudança, relatório de cobertura, erros, custo e esforço de manutenção; backup e restauração verificados.
Aceite: validar regras com o usuário e implantar no TheVault somente após confirmação operacional. Verificar atualização real via GitHub, versão em execução, persistência dos dados e mensagem Telegram; testar recuperação de falha em ambiente seguro. Validação local não equivale a validação no servidor.

### 6. Expansões opcionais
Busca automática de ofertas, produtos alternativos, anexos de nota fiscal/garantia, cronograma da mudança, mais lojas e previsões de preço. Não entram no MVP. Busca exige confirmação de equivalência antes de monitorar; previsão requer histórico suficiente e não garante descontos.

## Casos mínimos de aceitação e testes futuros

- Modelo correto, voltagem errada: oferta rejeitada para comparação.
- Preço Pix versus parcelado: séries e regras não se confundem.
- Frete desconhecido: alerta de total final não dispara indevidamente.
- Oferta indisponível: não gera alerta de compra só por atingir o preço-alvo.
- Coleta com erro/CAPTCHA: histórico válido preservado e leitura marcada como desatualizada.
- Mesmo evento repetido ou job reexecutado: nenhuma segunda notificação indevida.
- Entrada no limite, saída e reentrada: comportamento determinístico conforme cooldown definido.
- Cupom condicionado ou clube: oferta identificada e excluída quando o usuário não aceitar a condição.
- Compra parcial: saldo continua pendente; compra concluída pausa monitoramento sem apagar histórico.
- Produto sem cotação: painel distingue incompletude de custo zero.
- Reinício durante coleta/envio: recuperação sem perda silenciosa ou spam.
- URL maliciosa e redirecionamento para rede privada: bloqueados.
- Release aprovada: atualização automática restrita ao projeto e versão/digest em execução confirmados.
- Build/teste falha: produção não recebe a versão.
- Deploy falha: alerta e recuperação compatível sem apagar volumes.
- Migração incompatível: atualização suspensa para revisão e aprovação.
- Acesso não autorizado: bloqueado, inclusive para configuração do destino Telegram.
- Testes unitários das regras monetárias/alertas, fixtures dos adaptadores, integração com banco/fila e ponta a ponta do fluxo de compra; validação real de coleta e notificação separada dos testes simulados.

## Custos, riscos e limites

Custos a considerar: hospedagem ou capacidade do servidor existente, backups, domínio se necessário, envio de mensagens e possíveis APIs de dados. Não há orçamento verificado nesta etapa. Auto-hospedagem reduz dependência de hospedagem externa, mas não elimina manutenção, energia ou custo de dados.

Principais riscos: bloqueio de fontes, alteração de páginas, preços por usuário/CEP/pagamento, troca de vendedor, frete não consultável e falsa equivalência entre produtos. Mitigações: piloto de coleta, suporte por loja, contexto explícito, confirmação de variantes, fallback manual e painel de saúde.

## Decisões pendentes

1. Fornecer links reais para avaliar as oito lojas; identidade de Fast Shop já confirmada.
2. Definir acesso privado/rede/VPN ou internet; uso individual não dispensa autenticação.
3. Aprovar release estável como gatilho ou escolher branch; definir repositório e janela de atualização.
4. Confirmar orçamento para APIs/serviços e volume aproximado de produtos.
5. Definir frete por CEP, retenção de backups e aprovar/ajustar a stack proposta.

**Próximo passo recomendado:** obter URLs reais para prova de coleta, detalhar política de releases e preparar a validação do protótipo visual. Não iniciar implantação ou automações no servidor nesta etapa.

## Execução (22/10/2026)

Decisões tomadas com o usuário antes de executar:
- **Stack:** a mesma do Shelf — React/Vite + Hono + SQLite (`node:sqlite`), worker no mesmo container (substitui a proposta Next.js + PostgreSQL).
- **Acesso:** só rede privada (LAN/Tailscale), com login por senha.
- **Gatilho de atualização:** release estável publicada `vX.Y.Z` em `saladfruiter-labsGo/casa-nova`.
- **Escopo agora:** construir, testar e publicar no GitHub; implantar no TheVault só após liberação.
- **Links reais:** não fornecidos; a prova de coleta usou produtos públicos de exemplo em cada loja.

| Etapa | Resultado |
|---|---|
| 2. Prova de coleta | 3 lojas viáveis (Leroy Merlin, Carrefour, Fast Shop), 1 parcial (Amazon), 4 indisponíveis por bloqueio anti-bot/credencial (Casas Bahia, Pontofrio, Magalu, Mercado Livre) → preço manual. Detalhes: `docs/prova-de-coleta.md`. Observação de uma semana ainda pendente (acontece naturalmente com o app rodando). |
| 3. MVP organizador | Cadastro guiado, cômodos/categorias, ofertas manuais e automáticas, prioridades, orçamento, estados, compras parciais/entregas, painel, exportação CSV. Validado no navegador em desktop e 390 px (sem rolagem horizontal), fluxo real com link da Leroy Merlin. |
| 4. Monitoramento e alertas | Worker persistente, adaptadores JSON-LD/VTEX/Amazon, histórico imutável, saúde por oferta, preço-alvo, queda %, volta ao estoque, central de alertas e Telegram (outbox com deduplicação). 37 testes automatizados cobrindo os casos mínimos de aceitação. Alerta de teste real no Telegram depende do bot exclusivo (etapa 5). |
| 5. Piloto e implantação | Pendente de liberação: `docs/implantacao-thevault.md` + `deploy/casa-nova-updater.sh`. |

Pendências do usuário: aprovar implantação; criar bot exclusivo no @BotFather; validar visualmente a interface; (opcional) app OAuth do Mercado Livre.
