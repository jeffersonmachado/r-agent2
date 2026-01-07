#!/bin/bash
# Script para parar processos uvicorn órfãos que não são gerenciados pelo systemd

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🔍 Procurando processos uvicorn órfãos...${NC}"

# Obtém o PID do processo gerenciado pelo systemd
SYSTEMD_PID=$(systemctl show r-agent2-rag --property MainPID --value 2>/dev/null || echo "")

if [ -n "$SYSTEMD_PID" ]; then
    echo -e "${GREEN}✅ Processo do systemd encontrado: PID $SYSTEMD_PID${NC}"
else
    echo -e "${YELLOW}⚠️  Serviço systemd não está rodando${NC}"
fi

# Lista todos os processos uvicorn
ALL_UVICORN=$(ps aux | grep "uvicorn.*main:app" | grep -v grep | awk '{print $2}')

if [ -z "$ALL_UVICORN" ]; then
    echo -e "${GREEN}✅ Nenhum processo uvicorn encontrado${NC}"
    exit 0
fi

echo -e "${YELLOW}📋 Processos uvicorn encontrados:${NC}"
ps aux | grep "uvicorn.*main:app" | grep -v grep

# Para processos que NÃO são do systemd
ORPHAN_COUNT=0
for pid in $ALL_UVICORN; do
    if [ "$pid" != "$SYSTEMD_PID" ]; then
        echo -e "${YELLOW}🗑️  Parando processo órfão: PID $pid${NC}"
        sudo kill $pid 2>/dev/null || sudo kill -9 $pid 2>/dev/null || true
        ORPHAN_COUNT=$((ORPHAN_COUNT + 1))
    else
        echo -e "${GREEN}✅ Mantendo processo do systemd: PID $pid${NC}"
    fi
done

if [ $ORPHAN_COUNT -gt 0 ]; then
    sleep 2
    echo -e "${GREEN}✅ $ORPHAN_COUNT processo(s) órfão(s) parado(s)${NC}"
else
    echo -e "${GREEN}✅ Nenhum processo órfão encontrado${NC}"
fi

# Verifica processos restantes
REMAINING=$(ps aux | grep "uvicorn.*main:app" | grep -v grep | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo -e "${YELLOW}📋 Processos restantes:${NC}"
    ps aux | grep "uvicorn.*main:app" | grep -v grep
fi
