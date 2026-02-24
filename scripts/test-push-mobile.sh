#!/bin/bash

# Script para testar Push Notifications no app mobile
# Uso: ./scripts/test-push-mobile.sh --user-id USER_ID --title "Título" --body "Mensagem"

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
section() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# Default values
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
USER_ID=""
TITLE="Teste de Push"
BODY="Notificação de teste do app mobile"
AUTH_TOKEN="${AUTH_TOKEN:-}"
TENANT_ID="${TENANT_ID:-}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --user-id)
            USER_ID="$2"
            shift 2
            ;;
        --title)
            TITLE="$2"
            shift 2
            ;;
        --body)
            BODY="$2"
            shift 2
            ;;
        --api-url)
            API_BASE_URL="$2"
            shift 2
            ;;
        --auth-token)
            AUTH_TOKEN="$2"
            shift 2
            ;;
        --tenant-id)
            TENANT_ID="$2"
            shift 2
            ;;
        *)
            error "Argumento desconhecido: $1"
            exit 1
            ;;
    esac
done

if [ -z "$USER_ID" ]; then
    error "Uso: $0 --user-id USER_ID [--title TITULO] [--body MENSAGEM] [--auth-token TOKEN]"
    exit 1
fi

section "📱 Teste de Push Notifications"

info "Configuração:"
echo "  API Base URL:   $API_BASE_URL"
echo "  Usuário:        $USER_ID"
echo "  Título:         $TITLE"
echo "  Mensagem:       $BODY"
echo ""

section "Passo 1: Verificar App está Rodando"

# Verificar se app está rodando via ADB (opcional)
if command -v adb &> /dev/null; then
    if adb devices | grep -q "device$"; then
        info "✓ Dispositivo Android conectado via ADB"
        
        # Verificar se app está rodando
        if adb shell pidof com.results.ragent2 > /dev/null 2>&1; then
            info "✓ App está rodando"
        else
            warn "App não está rodando no device, iniciando..."
            adb shell am start -n com.results.ragent2/.MainActivity
            sleep 3
        fi
    fi
fi

section "Passo 2: Ver Tokens de Push Registrados"

info "Para ver quais tokens estão registrados, execute em environment de desenvolvimento:"
echo ""
echo "  curl -X GET \\
  -H 'Authorization: Bearer \$AUTH_TOKEN' \\
  $API_BASE_URL/api/push/tokens"
echo ""

section "Passo 3: Enviar Notificação de Push"

# Montar payload
PAYLOAD=$(cat <<EOF
{
  "userId": "$USER_ID",
  "notification": {
    "title": "$TITLE",
    "body": "$BODY"
  },
  "data": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "test": "true"
  }
}
EOF
)

info "Payload:"
echo "$PAYLOAD" | jq '.' || echo "$PAYLOAD"
echo ""

# Se tiver token de auth, tentar enviar para a API
if [ -n "$AUTH_TOKEN" ]; then
    info "Enviando para API..."
    
    RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "$API_BASE_URL/api/push/send" 2>&1 || true)
    
    if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
        info "✓ Resposta da API:"
        echo "$RESPONSE" | jq '.'
    else
        warn "Resposta não é JSON válido:"
        echo "$RESPONSE"
    fi
else
    warn "AUTH_TOKEN não set. Para enviar de fato, defina:"
    echo ""
    echo "  export AUTH_TOKEN='seu-token-jwt'"
    echo "  ./scripts/test-push-mobile.sh --user-id $USER_ID --auth-token \$AUTH_TOKEN"
    echo ""
fi

section "Passo 4: Ver Logs no App"

if command -v adb &> /dev/null; then
    info "Para ver logs de push em tempo real:"
    echo ""
    echo "  adb logcat | grep -E 'push|notification|expo-notif'"
    echo ""
    info "Ou capturar logs para análise:"
    echo ""
    echo "  adb logcat > /tmp/push-logs.txt &"
    echo "  # ... esperar notificação chegar ..."
    echo "  kill %1"
    echo "  cat /tmp/push-logs.txt | grep -i push"
    echo ""
fi

section "✅ Teste de Push Configurado"

info "Próximos passos:"
echo "1. Certifique-se de que o app está rodando no smartphone"
echo "2. Verifique se há tokens registrados para o usuário"
echo "3. Envie a notificação de teste"
echo "4. Verifique se a notificação aparece no device"
echo "5. Veja os logs para troubleshooting"
echo ""

info "Troubleshooting:"
echo ""
echo "❌ Push não aparecer:"
echo "  - Verificar se app está rodando: adb shell pidof com.results.ragent2"
echo "  - Verificar permissões: adb shell pm dump com.results.ragent2"
echo "  - Checar logs: adb logcat | grep -i push"
echo "  - Verificar se há tokens registrados no DB"
echo ""
echo "❌ 'Firebase não inicializado':"
echo "  - Garantir google-services.json está em apps/mobile/android/app/"
echo "  - Fazer rebuild: npx expo run:android"
echo ""
echo "❌ Erro de autenticação:"
echo "  - Verificar if AUTH_TOKEN é válido"
echo "  - Verificar se endpoint da API existe"
echo ""
