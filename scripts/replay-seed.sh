#!/bin/bash
# Script para simular e visualizar replay dos fluxos criados no seed
# Mostra as mensagens do bot e onde o usuário deve digitar

API_URL="${API_URL:-http://localhost:3000}"

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}                    🌱 REPLAY DOS FLUXOS DO SEED${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Verificar se jq está instalado
if ! command -v jq &> /dev/null; then
  echo -e "${RED}❌ jq não está instalado${NC}"
  echo "   Instale com: sudo apt-get install jq (Ubuntu/Debian) ou brew install jq (macOS)"
  exit 1
fi

# Verificar se API está rodando
if ! curl -s "$API_URL/health" > /dev/null 2>&1; then
  echo -e "${RED}❌ API não está respondendo em $API_URL${NC}"
  echo "   Inicie o servidor com: npm start"
  exit 1
fi

# Função para simular e mostrar replay
simulate_and_show_replay() {
  local FLOW_ID=$1
  local SCENARIO_NAME=$2
  
  echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${MAGENTA}📋 $SCENARIO_NAME${NC}"
  echo -e "${MAGENTA}   Fluxo: $FLOW_ID${NC}"
  echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  
  # Simular fluxo
  echo -e "${YELLOW}🔄 Simulando fluxo...${NC}"
  
  SESSION_RESPONSE=$(curl -s -X POST "$API_URL/flows/simulate" \
    -H "Content-Type: application/json" \
    -d "{
      \"flowId\": \"$FLOW_ID\",
      \"maxSteps\": 30
    }")
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erro ao simular fluxo${NC}"
    return 1
  fi
  
  # Verificar se houve erro na simulação
  if echo "$SESSION_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR_MSG=$(echo "$SESSION_RESPONSE" | jq -r '.message // .error')
    echo -e "${RED}❌ Erro na simulação: $ERROR_MSG${NC}"
    return 1
  fi
  
  # Extrair sessionId
  SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.replay.sessionId // empty')
  
  if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
    echo -e "${YELLOW}⚠️  Tentando obter sessionId de outra forma...${NC}"
    SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.events[0].sessionId // empty')
  fi
  
  if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
    echo -e "${RED}❌ Não foi possível obter sessionId${NC}"
    echo "Resposta:"
    echo "$SESSION_RESPONSE" | jq '.' | head -20
    return 1
  fi
  
  echo -e "${GREEN}✅ SessionId: $SESSION_ID${NC}"
  echo ""
  
  # Buscar replay
  echo -e "${CYAN}📱 Buscando replay...${NC}"
  REPLAY_RESPONSE=$(curl -s -X GET "$API_URL/replay/$SESSION_ID")
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erro ao buscar replay${NC}"
    return 1
  fi
  
  # Verificar se encontrou
  if echo "$REPLAY_RESPONSE" | grep -q "session_not_found"; then
    echo -e "${RED}❌ Sessão não encontrada${NC}"
    return 1
  fi
  
  # Extrair informações
  SESSION_ID_REPLAY=$(echo "$REPLAY_RESPONSE" | jq -r '.sessionId // "N/A"')
  FLOW_ID_REPLAY=$(echo "$REPLAY_RESPONSE" | jq -r '.flowId // "N/A"')
  TOTAL_MESSAGES=$(echo "$REPLAY_RESPONSE" | jq '.messages | length')
  
  # Mostrar informações
  echo -e "${CYAN}📋 Informações:${NC}"
  echo "   Session ID: $SESSION_ID_REPLAY"
  echo "   Flow ID: $FLOW_ID_REPLAY"
  echo "   Total de mensagens: $TOTAL_MESSAGES"
  echo ""
  
  # Mostrar steps da simulação para ver onde parou
  echo -e "${YELLOW}📝 Steps da Simulação:${NC}"
  STEPS_COUNT=$(echo "$SESSION_RESPONSE" | jq '.steps | length')
  echo "   Total de steps executados: $STEPS_COUNT"
  echo ""
  
  # Mostrar nós visitados primeiro para entender o fluxo
  NODES_COUNT=$(echo "$REPLAY_RESPONSE" | jq '.nodesVisited | length')
  if [ "$NODES_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}📍 Nós Visitados no Fluxo:${NC}"
    echo "$REPLAY_RESPONSE" | jq -r '.nodesVisited[] | "   • " + (.nodeId // "null")' | head -20
    echo ""
  fi
  
  # Mostrar onde o fluxo parou (último nó)
  LAST_NODE=$(echo "$SESSION_RESPONSE" | jq -r '.steps[-1].stateAfter.currentNodeId // "N/A"')
  if [ "$LAST_NODE" != "N/A" ] && [ "$LAST_NODE" != "null" ]; then
    LAST_NODE_TYPE=$(echo "$SESSION_RESPONSE" | jq -r '.steps[-1].stateAfter.currentNodeId // ""' | xargs -I {} sh -c 'curl -s "$API_URL/flows/$FLOW_ID_REPLAY" | jq -r ".nodes[] | select(.id == \"{}\") | .type"')
    if [ -n "$LAST_NODE_TYPE" ]; then
      if [ "$LAST_NODE_TYPE" = "user_input" ] || [ "$LAST_NODE_TYPE" = "userInput" ]; then
        echo -e "${MAGENTA}⏸️  Fluxo pausado aguardando entrada do usuário no nó: $LAST_NODE${NC}"
        echo ""
      fi
    fi
  fi
  
  if [ "$TOTAL_MESSAGES" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Nenhuma mensagem encontrada no replay${NC}"
    echo ""
    echo "Eventos disponíveis:"
    echo "$REPLAY_RESPONSE" | jq -r '.rawEvents[] | "\(.type) - \(.nodeId // "N/A")"' | head -15
    echo ""
    
    # Mostrar outputs dos steps
    echo -e "${YELLOW}📤 Outputs dos Steps:${NC}"
    echo "$SESSION_RESPONSE" | jq -r '.steps[] | "Step \(.index): \(.output.type // "N/A") - Node: \(.stateAfter.currentNodeId // "N/A")"' | head -10
    echo ""
    return 0
  fi
  
  # Mostrar conversa
  echo -e "${CYAN}💬 CONVERSA (Mensagens do Bot e do Usuário):${NC}"
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
        echo "$TEXT" | fold -w 55 -s | while IFS= read -r line; do
          echo -e "${GREEN}│${NC} $line"
        done
        echo -e "${GREEN}└─────────────────────────────────────────────────────────────┘${NC}"
        ;;
      "user")
        echo -e "${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
        echo -e "${CYAN}│${NC} ${YELLOW}👤 USUÁRIO${NC} ${YELLOW}[$TIME]${NC}"
        echo -e "${CYAN}│${NC}"
        echo "$TEXT" | fold -w 55 -s | while IFS= read -r line; do
          echo -e "${CYAN}│${NC} $line"
        done
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
    echo -e "${YELLOW}🔄 Transferências para Atendimento Humano:${NC}"
    echo "$REPLAY_RESPONSE" | jq -r '.handoffs[] | "   📞 Fila: " + .queue + " - " + .at'
    echo ""
  fi
  
  # Estatísticas
  TOTAL_EVENTS=$(echo "$REPLAY_RESPONSE" | jq '.rawEvents | length')
  BOT_MSGS=$(echo "$REPLAY_RESPONSE" | jq '[.messages[] | select(.from == "bot")] | length')
  USER_MSGS=$(echo "$REPLAY_RESPONSE" | jq '[.messages[] | select(.from == "user")] | length')
  
  echo -e "${CYAN}📊 Estatísticas:${NC}"
  echo "   Total de eventos: $TOTAL_EVENTS"
  echo "   Mensagens do bot: $BOT_MSGS"
  echo "   Mensagens do usuário: $USER_MSGS"
  echo "   Steps executados: $STEPS_COUNT"
  echo ""
  
  return 0
}

# Simular cada fluxo do seed
echo -e "${CYAN}🚀 Iniciando simulações dos fluxos criados no seed...${NC}"
echo ""

# Fluxo 1: flow-welcome
simulate_and_show_replay "flow-welcome" "Fluxo de Boas-Vindas"
echo ""
sleep 1

# Fluxo 2: flow-support
simulate_and_show_replay "flow-support" "Fluxo de Suporte"
echo ""

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}                    ✅ TODAS AS SIMULAÇÕES CONCLUÍDAS${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${CYAN}💡 Nota: Os fluxos podem parar em nós 'user_input' aguardando entrada do usuário.${NC}"
echo -e "${CYAN}   Para ver replay completo com inputs, use o frontend ou forneça inputs via API.${NC}"
echo ""
echo -e "${CYAN}💡 Para ver replay de uma sessão específica:${NC}"
echo "   ./scripts/ver-replay.sh session-1234567890"
echo ""

