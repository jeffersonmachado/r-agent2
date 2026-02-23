#!/bin/bash
# Script para monitorar logs do CRM em tempo real

echo "🔍 Monitorando logs de CRM e Pipeline WhatsApp..."
echo "=================================="
echo ""

# Cores para melhor visualização
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Filtra e formata logs relevantes
grep -E "TicketCRM|WA_PIPE|WA_INBOUND|CRM" --line-buffered --color=never | while IFS= read -r line; do
  if [[ $line == *"[TicketCRM]"* ]]; then
    echo -e "${GREEN}[CRM]${NC} $line"
  elif [[ $line == *"WA_PIPE"* ]]; then
    echo -e "${BLUE}[WhatsApp Pipeline]${NC} $line"
  elif [[ $line == *"WA_INBOUND"* ]]; then
    echo -e "${YELLOW}[WhatsApp Inbound]${NC} $line"
  elif [[ $line == *"CRM"* ]]; then
    echo -e "${GREEN}[CRM]${NC} $line"
  else
    echo "$line"
  fi
done
