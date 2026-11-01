# Implantação no TheVault

> **Status:** não implantado. Aguardando liberação explícita. Nada abaixo foi executado no servidor.

## Diagnóstico read-only já feito (22/10/2026)

- 12 CPUs, 30 GiB RAM (18 GiB disponíveis). Docker em uso com ~40 containers.
- Porta **3000** ocupada pelo Shelf; **3010** livre na lista de containers.
- Padrão existente: Compose Manager, dados em `/mnt/user/appdata/<app>`, imagens no GHCR.
- O TheVault também recebe 403 de Casas Bahia, Pontofrio e Magalu (mesmo resultado do host do Hermes).

## Passos executados (31/10/2026)

1. **Criar diretórios** (não disruptivo):
   ```bash
   mkdir -p /mnt/user/appdata/casa-nova/{data,backups}
   chown -R 1000:1000 /mnt/user/appdata/casa-nova/data /mnt/user/appdata/casa-nova/backups   # usuário "node" da imagem
   ```
2. **Copiar** `docker-compose.yml` e `.env.example` → `/mnt/user/appdata/casa-nova/.env`; preencher:
   - `CASA_NOVA_BIND` = IP da LAN (ex.: `192.168.1.90`) ou do Tailscale → acesso só privado;
   - `APP_PASSWORD_HASH` (gerar com `server/cli.ts hash-password`);
   - `TELEGRAM_BOT_TOKEN` de um **bot novo e exclusivo** (o do Hermes não serve: `getUpdates` conflita).
3. **Subir:** `docker compose up -d` no diretório (ou pelo Compose Manager). Impacto: apenas um container novo.
4. **Verificar:** `/api/health` mostra a versão; login; vincular Telegram e **enviar teste**; adicionar um produto real; conferir backup em `backups/`.
5. **Atualizador:** instalar `deploy/casa-nova-updater.sh` no User Scripts com agenda (sugestão: a cada 30 min). Ele só age em releases estáveis `vX.Y.Z`, nunca em versão MAJOR nova, e só no serviço `casa-nova`.
6. **Teste de restauração** (ambiente seguro): copiar um `backups/*.db` para um diretório temporário e subir uma segunda instância apontando para ele em outra porta; conferir dados; remover a instância de teste.

## Como publicar uma versão

1. Atualizar `version` no `package.json` (ex.: `0.1.1`), commit na `main`, CI verde.
2. Publicar release `v0.1.1` no GitHub (não marcar como pre-release).
3. O workflow **Release** roda testes e publica `ghcr.io/saladfruiter-labsgo/casa-nova:0.1.1` (+ `sha-…`, `stable`). Teste falhando = nada publicado.
4. O atualizador do TheVault detecta, faz backup verificado, troca a imagem, confere saúde **e** versão em execução, e avisa no Telegram. Em falha, volta à imagem anterior quando o banco permite e **suspende** novas tentativas (`updater.suspended`).

## Rollback e migrações

- O app guarda a versão do esquema no banco. Uma versão antiga **recusa iniciar** sobre um banco mais novo (evita corrupção).
- Antes de qualquer migração, o app cria `backups/…pre-migracao-vX-para-vY.db` automaticamente; o atualizador cria também `pre-update-X.Y.Z`.
- Rollback de imagem não desfaz migração. Se for preciso voltar após migração: parar o container, restaurar o backup `pre-update` correspondente para `data/casa-nova.db` (removendo `-wal`/`-shm`), subir a versão anterior. Exige sua confirmação.
