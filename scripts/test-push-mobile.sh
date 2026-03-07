#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
section() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

usage() {
  cat <<'EOF'
Uso:
  ./scripts/test-push-mobile.sh --user-id USER_ID [opções]

Opções:
  --api-url URL            Base da API (padrão: API_BASE_URL env ou http://localhost:3001)
  --user-id ID             Usuário destino (obrigatório)
  --tenant-id ID           Tenant destino (opcional; usa "system" por padrão)
  --title TITULO           Título da notificação
  --body TEXTO             Corpo da notificação
  --auth-token TOKEN       JWT já pronto (opcional)
  --username USER          Usuário para gerar token automaticamente (padrão: systemadmin)
  --password PASS          Senha para gerar token automaticamente (padrão: Admin123!)
EOF
}

API_BASE_URL="${API_BASE_URL:-http://localhost:3001}"
USER_ID=""
TENANT_ID="${TENANT_ID:-system}"
TITLE="Teste de Push"
BODY="Notificação de teste do app mobile"
AUTH_TOKEN="${AUTH_TOKEN:-}"
LOGIN_USERNAME="${TEST_PUSH_USERNAME:-systemadmin}"
LOGIN_PASSWORD="${TEST_PUSH_PASSWORD:-Admin123!}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url) API_BASE_URL="$2"; shift 2 ;;
    --user-id) USER_ID="$2"; shift 2 ;;
    --tenant-id) TENANT_ID="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --body) BODY="$2"; shift 2 ;;
    --auth-token) AUTH_TOKEN="$2"; shift 2 ;;
    --username) LOGIN_USERNAME="$2"; shift 2 ;;
    --password) LOGIN_PASSWORD="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) error "Argumento desconhecido: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$USER_ID" ]]; then
  error "--user-id é obrigatório"
  usage
  exit 1
fi

if [[ -z "$AUTH_TOKEN" ]]; then
  if [[ -f "scripts/set-token-env.sh" ]]; then
    # shellcheck disable=SC1091
    source scripts/set-token-env.sh \
      --base "$API_BASE_URL" \
      --username "$LOGIN_USERNAME" \
      --password "$LOGIN_PASSWORD" \
      --no-save
    AUTH_TOKEN="${TOKEN:-}"
  fi
fi

if [[ -z "$AUTH_TOKEN" ]]; then
  error "Não foi possível obter token JWT (use --auth-token ou ajuste credenciais)"
  exit 1
fi

PAYLOAD=$(cat <<EOF
{
  "userId": "$USER_ID",
  "tenantId": "$TENANT_ID",
  "notification": {
    "title": "$TITLE",
    "body": "$BODY"
  },
  "data": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "test": "true",
    "source": "scripts/test-push-mobile.sh"
  }
}
EOF
)

section "Teste Push Mobile"
info "API:        $API_BASE_URL"
info "Tenant:     $TENANT_ID"
info "User:       $USER_ID"
info "Titulo:     $TITLE"

section "Envio"
RESPONSE="$(curl -sS -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -d "$PAYLOAD" \
  "$API_BASE_URL/push/send")"

echo "$RESPONSE"

SENT="$(echo "$RESPONSE" | node -e "try{const j=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(j.sent ?? ''));}catch{process.stdout.write('');}")"
FAILED="$(echo "$RESPONSE" | node -e "try{const j=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(j.failed ?? ''));}catch{process.stdout.write('');}")"
OK="$(echo "$RESPONSE" | node -e "try{const j=JSON.parse(require('fs').readFileSync(0,'utf8')); process.stdout.write(String(j.ok ?? ''));}catch{process.stdout.write('');}")"

if [[ "$OK" == "true" && "${SENT:-0}" != "0" && "${FAILED:-0}" == "0" ]]; then
  info "Push enviado com sucesso (sent=$SENT, failed=$FAILED)"
  exit 0
fi

warn "Push sem envio efetivo ou com falha (ok=$OK, sent=${SENT:-?}, failed=${FAILED:-?})"
exit 2
