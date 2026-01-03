#!/bin/bash
# Script para visualizar os dados criados pelo seed

echo "🌱 DADOS CRIADOS PELO SEED"
echo "=========================="
echo ""

if ! command -v jq &> /dev/null; then
  echo "⚠️  jq não está instalado. Instalando para melhor visualização..."
  echo "   sudo apt-get install jq (Ubuntu/Debian)"
  echo "   brew install jq (macOS)"
  exit 1
fi

DATA_DIR="api/data"

echo "📋 RESUMO DOS DADOS:"
echo ""

# Agentes
if [ -f "$DATA_DIR/agents.json" ]; then
  AGENTS_COUNT=$(jq 'length' "$DATA_DIR/agents.json" 2>/dev/null || echo "0")
  echo "👤 Agentes: $AGENTS_COUNT"
  echo "   Usuários criados:"
  jq -r '.[] | "      • \(.username) (\(.role)) - \(.email)"' "$DATA_DIR/agents.json" 2>/dev/null | head -10
  echo ""
fi

# Fluxos
if [ -f "$DATA_DIR/flows.json" ]; then
  FLOWS_COUNT=$(jq 'length' "$DATA_DIR/flows.json" 2>/dev/null || echo "0")
  echo "🔄 Fluxos: $FLOWS_COUNT"
  echo "   Fluxos disponíveis:"
  jq -r '.[] | "      • \(.id) - \(.name)"' "$DATA_DIR/flows.json" 2>/dev/null
  echo ""
fi

# Filas
if [ -f "$DATA_DIR/queues.json" ]; then
  QUEUES_COUNT=$(jq '.queues | length' "$DATA_DIR/queues.json" 2>/dev/null || echo "0")
  echo "📋 Filas: $QUEUES_COUNT"
  jq -r '.queues | keys[] | "      • \(.)"' "$DATA_DIR/queues.json" 2>/dev/null
  echo ""
fi

# Departamentos
if [ -f "$DATA_DIR/departments.json" ]; then
  DEPTS_COUNT=$(jq '.departments | length' "$DATA_DIR/departments.json" 2>/dev/null || echo "0")
  echo "🏢 Departamentos: $DEPTS_COUNT"
  jq -r '.departments[] | "      • \(.name) - \(.description)"' "$DATA_DIR/departments.json" 2>/dev/null
  echo ""
fi

# Respostas Rápidas
if [ -f "$DATA_DIR/quickReplies.json" ]; then
  QR_COUNT=$(jq '.quickReplies | length' "$DATA_DIR/quickReplies.json" 2>/dev/null || echo "0")
  echo "💬 Respostas Rápidas: $QR_COUNT"
  jq -r '.quickReplies[] | "      • \(.title) - \(.category)"' "$DATA_DIR/quickReplies.json" 2>/dev/null | head -10
  echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🚀 Para ver o replay dos fluxos:"
echo "   ./scripts/replay-seed.sh"
echo ""
echo "💡 Para ver replay de uma sessão específica:"
echo "   ./scripts/ver-replay.sh session-1234567890"
echo ""

