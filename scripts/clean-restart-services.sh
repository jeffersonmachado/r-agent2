#!/bin/bash
# Script para limpar processos duplicados e reiniciar serviços

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🧹 Limpando processos duplicados...${NC}"

# Primeiro, para o container Docker do RAG (se estiver rodando)
echo -e "${YELLOW}🐳 Verificando containers Docker do RAG...${NC}"
RAG_CONTAINER=$(docker ps -a --filter "name=r-agent2-rag" --format "{{.ID}}" 2>/dev/null | head -1)
if [ -n "$RAG_CONTAINER" ]; then
    echo -e "${YELLOW}   Container Docker encontrado: $RAG_CONTAINER${NC}"
    echo -e "${YELLOW}   Parando container Docker...${NC}"
    docker stop $RAG_CONTAINER 2>/dev/null || true
    sleep 2
else
    echo -e "${GREEN}   Nenhum container Docker do RAG encontrado${NC}"
fi

# Para o serviço do systemd para evitar conflitos
echo -e "${YELLOW}⏹️  Parando serviço RAG do systemd...${NC}"
sudo systemctl stop r-agent2-rag 2>/dev/null || true
sleep 2

# Agora para TODOS os processos uvicorn (incluindo órfãos)
echo -e "${YELLOW}⏹️  Parando todos os processos uvicorn...${NC}"
UVICORN_PIDS=$(ps aux | grep "uvicorn.*main:app" | grep -v grep | awk '{print $2}')
if [ -n "$UVICORN_PIDS" ]; then
    echo -e "${YELLOW}   Encontrados processos uvicorn: $UVICORN_PIDS${NC}"
    for pid in $UVICORN_PIDS; do
        echo -e "${YELLOW}   Parando PID: $pid${NC}"
        sudo kill $pid 2>/dev/null || true
    done
    sleep 3
    
    # Força parada se ainda estiver rodando
    REMAINING=$(ps aux | grep "uvicorn.*main:app" | grep -v grep | awk '{print $2}')
    if [ -n "$REMAINING" ]; then
        echo -e "${RED}⚠️  Forçando parada de processos restantes...${NC}"
        for pid in $REMAINING; do
            sudo kill -9 $pid 2>/dev/null || true
        done
        sleep 2
    fi
fi

# Verifica e libera a porta 8000
echo -e "${YELLOW}🔍 Verificando porta 8000...${NC}"
PORT_PIDS=$(lsof -ti:8000 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
    echo -e "${YELLOW}⚠️  Porta 8000 ainda está em uso por PIDs: $PORT_PIDS${NC}"
    for pid in $PORT_PIDS; do
        echo -e "${YELLOW}   Parando processo na porta 8000: PID $pid${NC}"
        sudo kill -9 $pid 2>/dev/null || true
    done
    sleep 2
fi

# Verifica se a porta está realmente livre
if lsof -i :8000 > /dev/null 2>&1; then
    echo -e "${RED}❌ Porta 8000 ainda está em uso após limpeza!${NC}"
    lsof -i :8000
    exit 1
else
    echo -e "${GREEN}✅ Porta 8000 está livre${NC}"
fi

# Reinicia Redis
echo -e "${YELLOW}🔄 Reiniciando Redis...${NC}"
sudo systemctl restart redis-server
sleep 2

# Verifica Redis
if redis-cli -p 6379 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis está rodando${NC}"
else
    echo -e "${RED}❌ Redis não está respondendo${NC}"
fi

# Reinicia RAG Service
echo -e "${YELLOW}🔄 Reiniciando RAG Service...${NC}"
sudo systemctl restart r-agent2-rag
sleep 5

# Verifica RAG Service
echo -e "${YELLOW}🔍 Verificando RAG Service...${NC}"
for i in {1..10}; do
    RESPONSE=$(curl -s http://localhost:8000/rag/health 2>&1)
    if echo "$RESPONSE" | grep -q "healthy\|status"; then
        echo -e "${GREEN}✅ RAG Service está respondendo${NC}"
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
        break
    else
        if [ $i -lt 10 ]; then
            echo -e "${YELLOW}   Tentativa $i/10: Aguardando... (resposta: ${RESPONSE:0:50})${NC}"
            sleep 2
        else
            echo -e "${RED}❌ RAG Service não está respondendo após 20 segundos${NC}"
            echo -e "${YELLOW}   Última resposta: $RESPONSE${NC}"
            echo -e "${YELLOW}   Verifique os logs: sudo journalctl -u r-agent2-rag -n 50${NC}"
        fi
    fi
done

echo ""
echo -e "${BLUE}📋 Status final:${NC}"
echo -e "${GREEN}Redis:${NC}"
redis-cli -p 6379 ping 2>&1 || echo "   Não disponível"

echo ""
echo -e "${GREEN}RAG Service:${NC}"
curl -s http://localhost:8000/rag/health 2>&1 | head -5 || echo "   Não disponível"

echo ""
echo -e "${BLUE}📝 Processos uvicorn ativos:${NC}"
ps aux | grep "uvicorn.*main:app" | grep -v grep || echo "   Nenhum processo uvicorn encontrado"
