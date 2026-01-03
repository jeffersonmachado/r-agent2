#!/bin/bash
# Exemplo de como usar o replay do sistema

API_URL="http://localhost:3000"

echo "🔍 Exemplo de uso do Replay"
echo "============================"
echo ""

# 1. Primeiro, vamos simular um fluxo para gerar eventos
echo "1️⃣  Simulando o fluxo 'flow-welcome'..."
echo ""

SESSION_RESPONSE=$(curl -s -X POST "$API_URL/flows/simulate" \
  -H "Content-Type: application/json" \
  -d '{
    "flowId": "flow-welcome",
    "maxSteps": 10
  }')

echo "Resposta da simulação:"
echo "$SESSION_RESPONSE" | jq '.' 2>/dev/null || echo "$SESSION_RESPONSE"
echo ""

# 2. Extrair o sessionId da resposta
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.replay.sessionId' 2>/dev/null)

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "❌ Não foi possível obter sessionId da simulação"
  echo "Tentando obter sessionId de outra forma..."
  SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "❌ Erro: Não foi possível obter sessionId"
  exit 1
fi

echo "✅ SessionId obtido: $SESSION_ID"
echo ""

# 3. Agora vamos buscar o replay usando o sessionId
echo "2️⃣  Buscando replay para sessionId: $SESSION_ID"
echo ""

REPLAY_RESPONSE=$(curl -s -X GET "$API_URL/replay/$SESSION_ID")

# 4. Mostrar a conversa de forma visual
echo "3️⃣  📱 CONVERSA - Mensagens do Bot e do Usuário"
echo "=================================================="
echo ""

if command -v jq &> /dev/null; then
  # Informações gerais
  SESSION_ID_REPLAY=$(echo "$REPLAY_RESPONSE" | jq -r '.sessionId')
  FLOW_ID=$(echo "$REPLAY_RESPONSE" | jq -r '.flowId')
  TOTAL_MESSAGES=$(echo "$REPLAY_RESPONSE" | jq '.messages | length')
  
  echo "📋 Informações da Sessão:"
  echo "   Session ID: $SESSION_ID_REPLAY"
  echo "   Flow ID: $FLOW_ID"
  echo "   Total de mensagens: $TOTAL_MESSAGES"
  echo ""
  echo "💬 Histórico da Conversa:"
  echo ""
  
  # Mostrar mensagens em formato de conversa
  echo "$REPLAY_RESPONSE" | jq -r '.messages[] | 
    if .from == "bot" then
      "🤖 BOT: " + .text + "\n   ⏰ " + .at
    elif .from == "user" then
      "👤 USUÁRIO: " + .text + "\n   ⏰ " + .at
    else
      "⚙️  SISTEMA: " + .text + "\n   ⏰ " + .at
    end
  ' | while IFS= read -r line; do
    echo "$line"
    echo ""
  done
  
  # Mostrar handoffs se houver
  HANDOFFS_COUNT=$(echo "$REPLAY_RESPONSE" | jq '.handoffs | length')
  if [ "$HANDOFFS_COUNT" -gt 0 ]; then
    echo ""
    echo "🔄 Transferências para Atendimento Humano:"
    echo "$REPLAY_RESPONSE" | jq -r '.handoffs[] | 
      "   📞 Fila: " + .queue + " - " + .at
    '
  fi
  
  # Mostrar nós visitados
  echo ""
  echo "📍 Nós Visitados no Fluxo:"
  echo "$REPLAY_RESPONSE" | jq -r '.nodesVisited[] | 
    "   • " + (.nodeId // "null") + " - " + .at
  ' | head -10
  
  echo ""
  echo "📊 Estatísticas:"
  TOTAL_EVENTS=$(echo "$REPLAY_RESPONSE" | jq '.rawEvents | length')
  BOT_MSGS=$(echo "$REPLAY_RESPONSE" | jq '[.messages[] | select(.from == "bot")] | length')
  USER_MSGS=$(echo "$REPLAY_RESPONSE" | jq '[.messages[] | select(.from == "user")] | length')
  echo "   Total de eventos: $TOTAL_EVENTS"
  echo "   Mensagens do bot: $BOT_MSGS"
  echo "   Mensagens do usuário: $USER_MSGS"
  
else
  echo "⚠️  Para ver a conversa formatada, instale 'jq':"
  echo "   sudo apt-get install jq  # Ubuntu/Debian"
  echo "   brew install jq          # macOS"
  echo ""
  echo "Replay completo (JSON):"
  echo "$REPLAY_RESPONSE"
fi

echo ""
echo "✅ Exemplo concluído!"
echo ""
echo "💡 Dica: Você pode usar o sessionId em qualquer momento para ver o replay:"
echo "   curl -X GET $API_URL/replay/$SESSION_ID | jq '.messages'"

