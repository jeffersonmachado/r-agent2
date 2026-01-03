#!/bin/bash
# Script para visualizar replay de forma clara e visual
# Mostra as mensagens do bot e do usuário como uma conversa

API_URL="${API_URL:-http://localhost:3000}"

# Cores para terminal
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Função para mostrar ajuda
show_help() {
  echo "Uso: $0 [sessionId]"
  echo ""
  echo "Opções:"
  echo "  sessionId    - ID da sessão para visualizar (se não fornecido, simula um fluxo primeiro)"
  echo "  --help, -h   - Mostra esta ajuda"
  echo ""
  echo "Exemplos:"
  echo "  $0                                    # Simula e mostra replay"
  echo "  $0 session-1234567890                 # Mostra replay de sessão específica"
  echo "  API_URL=http://localhost:3001 $0     # Usa API diferente"
}

# Verificar se precisa de ajuda
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  show_help
  exit 0
fi

SESSION_ID="$1"

# Se não forneceu sessionId, simular primeiro
if [ -z "$SESSION_ID" ]; then
  echo -e "${CYAN}🔍 Simulando fluxo para gerar replay...${NC}"
  echo ""
  
  SESSION_RESPONSE=$(curl -s -X POST "$API_URL/flows/simulate" \
    -H "Content-Type: application/json" \
    -d '{
      "flowId": "flow-welcome",
      "maxSteps": 20
    }')
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erro ao conectar com a API em $API_URL${NC}"
    echo "   Certifique-se de que o servidor está rodando: npm start"
    exit 1
  fi
  
  # Extrair sessionId
  if command -v jq &> /dev/null; then
    SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.replay.sessionId // empty')
    if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
      echo -e "${RED}❌ Erro: Não foi possível obter sessionId da simulação${NC}"
      echo "Resposta:"
      echo "$SESSION_RESPONSE" | jq '.' 2>/dev/null || echo "$SESSION_RESPONSE"
      exit 1
    fi
  else
    echo -e "${YELLOW}⚠️  jq não está instalado. Tentando extrair sessionId manualmente...${NC}"
    SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -z "$SESSION_ID" ]; then
      echo -e "${RED}❌ Não foi possível obter sessionId${NC}"
      exit 1
    fi
  fi
  
  echo -e "${GREEN}✅ Simulação concluída! SessionId: $SESSION_ID${NC}"
  echo ""
fi

# Buscar replay
echo -e "${CYAN}📱 Buscando replay da sessão: $SESSION_ID${NC}"
echo ""

REPLAY_RESPONSE=$(curl -s -X GET "$API_URL/replay/$SESSION_ID")

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Erro ao buscar replay${NC}"
  exit 1
fi

# Verificar se encontrou
if echo "$REPLAY_RESPONSE" | grep -q "session_not_found"; then
  echo -e "${RED}❌ Sessão não encontrada: $SESSION_ID${NC}"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo -e "${YELLOW}⚠️  jq não está instalado. Instalando para melhor visualização...${NC}"
  echo "   Para instalar: sudo apt-get install jq (Ubuntu/Debian) ou brew install jq (macOS)"
  echo ""
  echo "Replay (JSON):"
  echo "$REPLAY_RESPONSE"
  exit 0
fi

# Extrair informações
SESSION_ID_REPLAY=$(echo "$REPLAY_RESPONSE" | jq -r '.sessionId // "N/A"')
FLOW_ID=$(echo "$REPLAY_RESPONSE" | jq -r '.flowId // "N/A"')
TOTAL_MESSAGES=$(echo "$REPLAY_RESPONSE" | jq '.messages | length')

# Mostrar cabeçalho
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}                    📱 REPLAY DA CONVERSA${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}📋 Informações:${NC}"
echo "   Session ID: $SESSION_ID_REPLAY"
echo "   Flow ID: $FLOW_ID"
echo "   Total de mensagens: $TOTAL_MESSAGES"
echo ""

if [ "$TOTAL_MESSAGES" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  Nenhuma mensagem encontrada nesta sessão${NC}"
  echo ""
  echo "Eventos disponíveis:"
  echo "$REPLAY_RESPONSE" | jq '.rawEvents[] | "\(.type) - \(.nodeId // "N/A")"' | head -10
  exit 0
fi

# Mostrar conversa
echo -e "${CYAN}💬 HISTÓRICO DA CONVERSA:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Processar cada mensagem
echo "$REPLAY_RESPONSE" | jq -c '.messages[]' | while IFS= read -r msg; do
  FROM=$(echo "$msg" | jq -r '.from')
  TEXT=$(echo "$msg" | jq -r '.text // ""')
  AT=$(echo "$msg" | jq -r '.at // ""')
  
  # Formatar timestamp
  if [ -n "$AT" ] && [ "$AT" != "null" ]; then
    TIME=$(date -d "$AT" +"%H:%M:%S" 2>/dev/null || echo "$AT" | cut -d'T' -f2 | cut -d'.' -f1)
  else
    TIME="--:--:--"
  fi
  
  case "$FROM" in
    "bot")
      echo -e "${GREEN}┌─────────────────────────────────────────────────────────────┐${NC}"
      echo -e "${GREEN}│${NC} ${BLUE}🤖 BOT${NC} ${YELLOW}[$TIME]${NC}"
      echo -e "${GREEN}│${NC}"
      echo -e "${GREEN}│${NC} $TEXT" | fold -w 55 -s | sed "s/^/${GREEN}│${NC} /"
      echo -e "${GREEN}└─────────────────────────────────────────────────────────────┘${NC}"
      ;;
    "user")
      echo -e "${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
      echo -e "${CYAN}│${NC} ${YELLOW}👤 USUÁRIO${NC} ${YELLOW}[$TIME]${NC}"
      echo -e "${CYAN}│${NC}"
      echo -e "${CYAN}│${NC} $TEXT" | fold -w 55 -s | sed "s/^/${CYAN}│${NC} /"
      echo -e "${CYAN}└─────────────────────────────────────────────────────────────┘${NC}"
      ;;
    "system")
      echo -e "${YELLOW}⚙️  SISTEMA [$TIME]: $TEXT${NC}"
      ;;
    *)
      echo -e "${YELLOW}❓ DESCONHECIDO [$TIME]: $TEXT${NC}"
      ;;
  esac
  echo ""
done

# Mostrar handoffs
HANDOFFS_COUNT=$(echo "$REPLAY_RESPONSE" | jq '.handoffs | length')
if [ "$HANDOFFS_COUNT" -gt 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${YELLOW}🔄 Transferências para Atendimento Humano:${NC}"
  echo ""
  echo "$REPLAY_RESPONSE" | jq -r '.handoffs[] | 
    "   📞 Fila: " + .queue + " - " + .at
  '
  echo ""
fi

# Mostrar nós visitados
NODES_COUNT=$(echo "$REPLAY_RESPONSE" | jq '.nodesVisited | length')
if [ "$NODES_COUNT" -gt 0 ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${YELLOW}📍 Nós Visitados no Fluxo:${NC}"
  echo ""
  echo "$REPLAY_RESPONSE" | jq -r '.nodesVisited[] | 
    "   • " + (.nodeId // "null") + " - " + .at
  ' | head -20
  echo ""
fi

# Estatísticas
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}📊 Estatísticas:${NC}"
TOTAL_EVENTS=$(echo "$REPLAY_RESPONSE" | jq '.rawEvents | length')
BOT_MSGS=$(echo "$REPLAY_RESPONSE" | jq '[.messages[] | select(.from == "bot")] | length')
USER_MSGS=$(echo "$REPLAY_RESPONSE" | jq '[.messages[] | select(.from == "user")] | length')
echo "   Total de eventos: $TOTAL_EVENTS"
echo "   Mensagens do bot: $BOT_MSGS"
echo "   Mensagens do usuário: $USER_MSGS"
echo ""

echo -e "${GREEN}✅ Replay visualizado com sucesso!${NC}"
echo ""
echo "💡 Para ver o replay completo em JSON:"
echo "   curl -X GET $API_URL/replay/$SESSION_ID | jq '.'"

