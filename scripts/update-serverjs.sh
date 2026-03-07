#!/bin/bash
# update-serverjs.sh
# Atualiza server.js e package.json no container rodando, sem rebuildar a imagem

set -e

# Configurações
REMOTE_HOST="${DEPLOY_HOST:-10.10.2.30}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/results/ria/r-agent2}"
SSH_PASSWORD_VALUE="${SSH_PASSWORD:-resu100gabao}"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=20 -o TCPKeepAlive=yes"

# Alvos (permitem override por variável de ambiente)
CONTAINER_NAME="${DEPLOY_API_CONTAINER:-r-agent2-api-prod}"
LOCAL_SERVERJS="${DEPLOY_LOCAL_SERVERJS:-api/server.js}"
REMOTE_SERVERJS="${DEPLOY_REMOTE_SERVERJS:-$REMOTE_DIR/api/server.js}"
CONTAINER_PATH="${DEPLOY_CONTAINER_SERVERJS_PATH:-/app/api/server.js}"
LOCAL_PACKAGE_JSON="${DEPLOY_LOCAL_PACKAGE_JSON:-package.json}"
REMOTE_PACKAGE_JSON="${DEPLOY_REMOTE_PACKAGE_JSON:-$REMOTE_DIR/package.json}"
CONTAINER_PACKAGE_JSON_PATH="${DEPLOY_CONTAINER_PACKAGE_JSON_PATH:-/app/package.json}"

if [ ! -f "$LOCAL_SERVERJS" ]; then
  echo "[ERRO] Arquivo $LOCAL_SERVERJS não encontrado. Abortando."
  exit 1
fi

if [ ! -f "$LOCAL_PACKAGE_JSON" ]; then
  echo "[ERRO] Arquivo $LOCAL_PACKAGE_JSON não encontrado. Abortando."
  exit 1
fi

# Teste de conectividade
echo "[INFO] Testando conexão com $REMOTE_HOST..."
echo "[INFO]   Aguarde, isso pode levar alguns segundos..."
echo "[INFO]   Testando conectividade de rede..."
echo "[COMANDO] ping -c 1 -W 2 $REMOTE_HOST"
if ping -c 1 -W 2 "$REMOTE_HOST" &>/dev/null; then
  echo "[INFO]   ✅ Ping OK"
else
  echo "[ERRO] Não foi possível alcançar $REMOTE_HOST via ping. Abortando."
  exit 2
fi

echo "==> Copiando $LOCAL_SERVERJS para $REMOTE_USER@$REMOTE_HOST:$REMOTE_SERVERJS ..."
echo "[COMANDO] export SSHPASS=\"$SSH_PASSWORD_VALUE\" && /usr/bin/rsync -avz -e '/usr/bin/sshpass -e ssh $SSH_OPTS' $LOCAL_SERVERJS $REMOTE_USER@$REMOTE_HOST:$REMOTE_SERVERJS"
( export SSHPASS="$SSH_PASSWORD_VALUE"; /usr/bin/rsync -avz -e "/usr/bin/sshpass -e ssh $SSH_OPTS" "$LOCAL_SERVERJS" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_SERVERJS" )

echo "==> Copiando $LOCAL_PACKAGE_JSON para $REMOTE_USER@$REMOTE_HOST:$REMOTE_PACKAGE_JSON ..."
echo "[COMANDO] export SSHPASS=\"$SSH_PASSWORD_VALUE\" && /usr/bin/rsync -avz -e '/usr/bin/sshpass -e ssh $SSH_OPTS' $LOCAL_PACKAGE_JSON $REMOTE_USER@$REMOTE_HOST:$REMOTE_PACKAGE_JSON"
( export SSHPASS="$SSH_PASSWORD_VALUE"; /usr/bin/rsync -avz -e "/usr/bin/sshpass -e ssh $SSH_OPTS" "$LOCAL_PACKAGE_JSON" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PACKAGE_JSON" )

echo "==> Atualizando server.js e package.json dentro do container no servidor remoto..."
REMOTE_CMD="docker cp '$REMOTE_SERVERJS' '$CONTAINER_NAME:$CONTAINER_PATH' && docker cp '$REMOTE_PACKAGE_JSON' '$CONTAINER_NAME:$CONTAINER_PACKAGE_JSON_PATH' && docker restart '$CONTAINER_NAME'"
echo "[COMANDO SSH] /usr/bin/sshpass -e ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST \"$REMOTE_CMD\""
( export SSHPASS="$SSH_PASSWORD_VALUE"; /usr/bin/sshpass -e ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "$REMOTE_CMD" )

echo "==> Obtendo versão da API em produção..."
VERSION_URL="https://www.results.com.br/r-agent2/api/version"
MAX_ATTEMPTS=12
SLEEP_SECONDS=5
VERSION_OK=0

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "[INFO] Tentativa $attempt/$MAX_ATTEMPTS para obter versão..."
  echo "[COMANDO] curl -fsS --max-time 15 $VERSION_URL"
  if curl -fsS --max-time 15 "$VERSION_URL"; then
    VERSION_OK=1
    break
  fi

  echo "[AVISO] URL pública indisponível. Tentando localhost no servidor..."
  REMOTE_VERSION_CMD="curl -fsS --max-time 15 http://localhost:3001/version"
  echo "[COMANDO SSH] /usr/bin/sshpass -e ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST \"$REMOTE_VERSION_CMD\""
  if ( export SSHPASS="$SSH_PASSWORD_VALUE"; /usr/bin/sshpass -e ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "$REMOTE_VERSION_CMD" ); then
    VERSION_OK=1
    break
  fi

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "[INFO] API ainda inicializando. Aguardando ${SLEEP_SECONDS}s..."
    sleep "$SLEEP_SECONDS"
  fi
done

if [ "$VERSION_OK" -ne 1 ]; then
  echo "[ERRO] Não foi possível obter a versão da API após $MAX_ATTEMPTS tentativas."
  exit 3
fi

echo "==> Atualização remota concluída."
