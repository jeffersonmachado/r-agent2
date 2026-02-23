#!/bin/bash
# Monitor de logs em tempo real para pipeline WhatsApp + CRM

echo "🔍 MONITOR DE LOGS - Pipeline WhatsApp + CRM"
echo "==========================================="
echo ""
echo "Arquivo: logs/api/api.log"
echo "Padrões: WA_*, TicketCRM, CRM"
echo ""
echo "Pressione Ctrl+C para sair"
echo ""
echo "-------------------------------------------"
echo ""

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Monitora o arquivo de log
tail -f logs/api/api.log 2>/dev/null | grep --line-buffered -E "WA_|TicketCRM|CRM" | while IFS= read -r line; do
  # Extrai timestamp
  timestamp=$(echo "$line" | grep -oP '\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]' | tr -d '[]')
  
  # Coloriza baseado no tipo de log
  if [[ $line == *"[ERROR]"* ]] || [[ $line == *"WA_PIPE_SKIP"* ]]; then
    echo -e "${RED}${timestamp}${NC} $line"
  elif [[ $line == *"[WARN]"* ]]; then
    echo -e "${YELLOW}${timestamp}${NC} $line"
  elif [[ $line == *"TicketCRM"* ]]; then
    echo -e "${GREEN}${timestamp}${NC} $line"
  elif [[ $line == *"WA_INBOUND_ROUTE"* ]]; then
    echo -e "${CYAN}${timestamp}${NC} $line"
  elif [[ $line == *"WA_PIPE_START"* ]]; then
    echo -e "${BLUE}${timestamp}${NC} $line"
  else
    echo "$line"
  fi
done
