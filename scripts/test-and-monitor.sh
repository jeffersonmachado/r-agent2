#!/bin/bash
# Script para testar pipeline WhatsApp e monitorar logs

PHONE="${1:-5511999887766}"
MESSAGE="${2:-Testando pipeline completo}"

echo "📱 Teste de Pipeline WhatsApp + CRM"
echo "===================================="
echo "Telefone: $PHONE"
echo "Mensagem: $MESSAGE"
echo ""

# Marca o tempo inicial
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S")

echo "⏰ Timestamp inicial: $TIMESTAMP"
echo ""

# Envia a mensagem
echo "📤 Enviando mensagem..."
node scripts/test-whatsapp-receive.js "$PHONE" "$MESSAGE" 2>&1 | grep -E "Status:|Resposta:|Erro"

echo ""
echo "⏳ Aguardando 2 segundos para processamento..."
sleep 2

echo ""
echo "📋 Logs esperados do pipeline:"
echo "  1. WA_IN_PRE - Mensagem recebida"
echo "  2. WA_INBOUND_ROUTE - Decisão de roteamento"
echo "  3. WA_PIPE_START - Início do processamento"
echo "  4. [TicketCRM] Novo contato CRM criado (se novo)"
echo "  5. [TicketCRM] Ticket vinculado ao contato"
echo "  6. WA_PIPE_HUMAN_MODE_ON ou WA_PIPE_BOT"
echo ""
echo "💡 Dica: Os logs aparecem no console onde o servidor está rodando"
echo "   Execute: cd /opt/results/ria/r-agent2 && npm start"
echo ""
echo "Para monitorar em tempo real, execute em outro terminal:"
echo "   tail -f api/logs/*.log (se configurado)"
echo "   ou veja o console do 'npm start'"
