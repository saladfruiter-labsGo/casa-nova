#!/bin/bash
# Casa Nova — atualizador automático para o TheVault (Unraid).
#
# Instalação (somente após aprovação): plugin User Scripts → novo script → colar este arquivo
# → agenda personalizada, ex.: "*/30 * * * *". Consulta o GitHub por conexão de SAÍDA; nada é exposto.
#
# Regras:
#  - só segue releases estáveis publicadas (vX.Y.Z) em saladfruiter-labsGo/casa-nova;
#  - versão MAJOR nova nunca é aplicada sozinha (exige ação manual);
#  - lock contra execuções concorrentes; checa espaço; backup verificado antes de trocar a imagem;
#  - mexe SOMENTE no serviço casa-nova deste diretório; nunca apaga volumes;
#  - confirma saúde E versão realmente em execução; em falha volta para a imagem anterior
#    (se o esquema do banco permitir) e SUSPENDE novas tentativas até revisão manual.
set -uo pipefail

APP_DIR="${APP_DIR:-/mnt/user/appdata/casa-nova}"
REPO="saladfruiter-labsGo/casa-nova"
IMAGE="ghcr.io/saladfruiter-labsgo/casa-nova"
LOG="$APP_DIR/updater.log"
SUSPEND="$APP_DIR/updater.suspended"
MIN_FREE_MB=1024

log() { echo "$(date -Iseconds) $*" | tee -a "$LOG"; }
env_get() { grep -E "^$1=" "$APP_DIR/.env" | tail -n1 | cut -d= -f2-; }
env_set() { sed -i "s|^$1=.*|$1=$2|" "$APP_DIR/.env"; }

notify() {
  # 1º: pelo próprio app (usa o chat vinculado); 2º: direto, se TELEGRAM_CHAT_ID estiver no .env
  docker exec casa-nova node_modules/.bin/tsx server/cli.ts notify "$1" >/dev/null 2>&1 && return 0
  local token chat
  token="$(env_get TELEGRAM_BOT_TOKEN)"; chat="$(env_get TELEGRAM_CHAT_ID)"
  if [ -n "$token" ] && [ -n "$chat" ]; then
    curl -fsS -m 15 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
      --data-urlencode "chat_id=${chat}" --data-urlencode "text=$1" >/dev/null 2>&1 && return 0
  fi
  log "aviso: não foi possível notificar no Telegram"
}

compose() { docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" "$@"; }

wait_healthy() { # $1 = versão esperada
  local port bind body
  port="$(env_get CASA_NOVA_PORT)"; port="${port:-3010}"
  bind="$(env_get CASA_NOVA_BIND)"; bind="${bind:-127.0.0.1}"
  for _ in $(seq 1 40); do
    body="$(curl -fsS -m 5 "http://${bind}:${port}/api/health" 2>/dev/null || true)"
    if echo "$body" | grep -q "\"ok\":true" && echo "$body" | grep -q "\"version\":\"$1\""; then return 0; fi
    sleep 3
  done
  return 1
}

exec 9>"/tmp/casa-nova-updater.lock"
flock -n 9 || { echo "outra execução em andamento"; exit 0; }
cd "$APP_DIR" || { echo "diretório $APP_DIR não existe"; exit 1; }
[ -f "$SUSPEND" ] && { echo "atualizações suspensas: $(cat "$SUSPEND")"; exit 0; }

CURRENT="$(env_get CASA_NOVA_TAG)"
LATEST_TAG="$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
[[ "$LATEST_TAG" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { log "release inválida ou GitHub indisponível: '$LATEST_TAG'"; exit 0; }
LATEST="${LATEST_TAG#v}"
[ "$LATEST" = "$CURRENT" ] && exit 0

if [ "${LATEST%%.*}" != "${CURRENT%%.*}" ]; then
  if [ ! -f "$APP_DIR/.major-notified-$LATEST" ]; then
    notify "Casa Nova: nova versão principal $LATEST_TAG disponível (atual $CURRENT). Exige atualização manual."
    touch "$APP_DIR/.major-notified-$LATEST"
  fi
  exit 0
fi

FREE_MB="$(df -Pm "$APP_DIR" | awk 'NR==2{print $4}')"
[ "${FREE_MB:-0}" -ge "$MIN_FREE_MB" ] || { log "espaço insuficiente (${FREE_MB} MB)"; notify "Casa Nova: atualização para $LATEST_TAG adiada por falta de espaço."; exit 0; }

log "atualizando $CURRENT -> $LATEST"
docker pull "$IMAGE:$LATEST" >>"$LOG" 2>&1 || { log "falha ao baixar imagem"; exit 0; }
compose config -q || { log "docker-compose.yml inválido"; echo "compose inválido" >"$SUSPEND"; exit 1; }

if ! docker exec casa-nova node_modules/.bin/tsx server/cli.ts backup "pre-update-$LATEST" >>"$LOG" 2>&1; then
  log "backup falhou; atualização cancelada"
  notify "Casa Nova: backup antes da atualização para $LATEST_TAG falhou. Nada foi alterado."
  exit 1
fi

env_set CASA_NOVA_TAG "$LATEST"
compose up -d --no-deps casa-nova >>"$LOG" 2>&1
if wait_healthy "$LATEST"; then
  DIGEST="$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE:$LATEST" 2>/dev/null)"
  log "ok: rodando $LATEST ($DIGEST)"
  notify "✅ Casa Nova atualizado para $LATEST_TAG. Versão em execução confirmada."
  exit 0
fi

log "falha de saúde em $LATEST; tentando voltar para $CURRENT"
docker logs --tail 50 casa-nova >>"$LOG" 2>&1
env_set CASA_NOVA_TAG "$CURRENT"
compose up -d --no-deps casa-nova >>"$LOG" 2>&1
if wait_healthy "$CURRENT"; then
  MSG="⚠️ Casa Nova: $LATEST_TAG falhou; voltou para $CURRENT e está saudável. Atualizações suspensas até revisão."
else
  MSG="🚨 Casa Nova: $LATEST_TAG falhou e $CURRENT não subiu (provável migração de banco incompatível). Restaure o backup pre-update-$LATEST manualmente. Atualizações suspensas."
fi
echo "$MSG" >"$SUSPEND"
log "$MSG"
notify "$MSG"
exit 1
