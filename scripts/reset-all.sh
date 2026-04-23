#!/bin/bash
# Script para resetar completamente a plataforma r-agent2
# Limpa: Docker, volumes, serviços, dados JSON, cache Redis

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Tenant para reset (obrigatório)
DEFAULT_TENANT=${1:-}
RESTART=${2:-false}

if [ -z "$DEFAULT_TENANT" ]; then
    echo -e "${RED}❌ Tenant ID é obrigatório.${NC}"
    echo -e "${YELLOW}Uso:${NC} ./scripts/reset-all.sh <tenant-id> --yes"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     🧹 RESET COMPLETO DA PLATAFORMA r-agent2         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Confirmação
if [ "$RESTART" != "--yes" ] && [ "$RESTART" != "-y" ]; then
    echo -e "${YELLOW}⚠️  ATENÇÃO: Este script irá:${NC}"
    echo -e "${YELLOW}   - Parar e remover TODOS os containers Docker${NC}"
    echo -e "${YELLOW}   - Remover TODOS os volumes Docker${NC}"
    echo -e "${YELLOW}   - Limpar processos e serviços${NC}"
    echo -e "${YELLOW}   - Limpar cache Redis${NC}"
    echo -e "${YELLOW}   - Resetar TODOS os dados JSON${NC}"
    echo -e "${YELLOW}   - Limpar arquivos gerados de testes RPA${NC}"
    echo ""
    read -p "Deseja continuar? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo -e "${RED}❌ Operação cancelada${NC}"
        exit 0
    fi
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📦 ETAPA 1: Limpando Containers Docker${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Para containers docker-compose.yml (desenvolvimento)
if [ -f "docker-compose.yml" ]; then
    echo -e "${YELLOW}🐳 Parando containers docker-compose.yml...${NC}"
    docker-compose down -v 2>/dev/null || true
    echo -e "${GREEN}   ✅ Containers docker-compose.yml parados${NC}"
fi

# Para containers docker-compose.prod.yml (produção)
if [ -f "docker-compose.prod.yml" ]; then
    echo -e "${YELLOW}🐳 Parando containers docker-compose.prod.yml...${NC}"
    docker-compose -f docker-compose.prod.yml down -v 2>/dev/null || true
    echo -e "${GREEN}   ✅ Containers docker-compose.prod.yml parados${NC}"
fi

# Remove containers órfãos
echo -e "${YELLOW}🐳 Removendo containers órfãos...${NC}"
docker ps -a --filter "name=r-agent2" --format "{{.ID}}" | xargs -r docker rm -f 2>/dev/null || true
docker ps -a --filter "name=chatbot" --format "{{.ID}}" | xargs -r docker rm -f 2>/dev/null || true
echo -e "${GREEN}   ✅ Containers órfãos removidos${NC}"

# Remove volumes órfãos
echo -e "${YELLOW}🐳 Removendo volumes órfãos...${NC}"
docker volume ls --filter "name=r-agent2" --format "{{.Name}}" | xargs -r docker volume rm 2>/dev/null || true
docker volume ls --filter "name=chatbot" --format "{{.Name}}" | xargs -r docker volume rm 2>/dev/null || true
echo -e "${GREEN}   ✅ Volumes órfãos removidos${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}⚙️  ETAPA 2: Limpando Serviços e Processos${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Para serviços systemd
echo -e "${YELLOW}⏹️  Parando serviços systemd...${NC}"
sudo systemctl stop r-agent2-rag 2>/dev/null || true
sudo systemctl stop redis-server 2>/dev/null || true
echo -e "${GREEN}   ✅ Serviços systemd parados${NC}"

# Para processos uvicorn
echo -e "${YELLOW}⏹️  Parando processos uvicorn...${NC}"
UVICORN_PIDS=$(ps aux | grep "uvicorn.*main:app" | grep -v grep | awk '{print $2}' || true)
if [ -n "$UVICORN_PIDS" ]; then
    for pid in $UVICORN_PIDS; do
        sudo kill -9 $pid 2>/dev/null || true
    done
    echo -e "${GREEN}   ✅ Processos uvicorn parados${NC}"
else
    echo -e "${GREEN}   ✅ Nenhum processo uvicorn encontrado${NC}"
fi

# Libera porta 8001
echo -e "${YELLOW}🔍 Liberando porta 8001...${NC}"
PORT_PIDS=$(lsof -ti:8001 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
    for pid in $PORT_PIDS; do
        sudo kill -9 $pid 2>/dev/null || true
    done
    echo -e "${GREEN}   ✅ Porta 8001 liberada${NC}"
else
    echo -e "${GREEN}   ✅ Porta 8001 já está livre${NC}"
fi

# Para processos Node.js da API (se rodando fora do Docker)
echo -e "${YELLOW}⏹️  Parando processos Node.js da API...${NC}"
NODE_PIDS=$(ps aux | grep "node.*api/server.js" | grep -v grep | awk '{print $2}' || true)
if [ -n "$NODE_PIDS" ]; then
    for pid in $NODE_PIDS; do
        kill $pid 2>/dev/null || true
    done
    echo -e "${GREEN}   ✅ Processos Node.js parados${NC}"
else
    echo -e "${GREEN}   ✅ Nenhum processo Node.js encontrado${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🗄️  ETAPA 3: Limpando Cache Redis${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Reinicia Redis para limpar cache
echo -e "${YELLOW}🔄 Reiniciando Redis...${NC}"
sudo systemctl start redis-server 2>/dev/null || true
sleep 2

# Limpa cache Redis
if redis-cli -p 6379 ping > /dev/null 2>&1; then
    echo -e "${YELLOW}🗑️  Limpando cache Redis...${NC}"
    redis-cli -p 6379 FLUSHALL 2>/dev/null || true
    echo -e "${GREEN}   ✅ Cache Redis limpo${NC}"
else
    echo -e "${YELLOW}   ⚠️  Redis não está disponível (pode estar rodando no Docker)${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📁 ETAPA 4: Resetando Dados JSON${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Verifica se o script de seed existe
if [ ! -f "scripts/seed.js" ]; then
    echo -e "${RED}❌ Erro: scripts/seed.js não encontrado${NC}"
    exit 1
fi

# Executa seed com reset
echo -e "${YELLOW}🌱 Executando seed com reset para tenant: ${DEFAULT_TENANT}...${NC}"
if node scripts/seed.js --reset --tenant="${DEFAULT_TENANT}" 2>/dev/null; then
    echo -e "${GREEN}   ✅ Dados JSON resetados${NC}"
else
    echo -e "${RED}   ❌ Erro ao resetar dados JSON${NC}"
    echo -e "${YELLOW}   Tentando continuar...${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🧪 ETAPA 5: Limpando Arquivos de Testes RPA${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Limpa arquivos de replay (apenas arquivos JSON gerados)
if [ -d "tests/rpa/replay" ]; then
    echo -e "${YELLOW}🗑️  Limpando arquivos de replay...${NC}"
    REPLAY_BEFORE=$(find tests/rpa/replay -type f -name "*.json" 2>/dev/null | wc -l)
    find tests/rpa/replay -type f -name "*.json" -delete 2>/dev/null || true
    REPLAY_AFTER=$(find tests/rpa/replay -type f -name "*.json" 2>/dev/null | wc -l)
    REMOVED=$((REPLAY_BEFORE - REPLAY_AFTER))
    echo -e "${GREEN}   ✅ Arquivos de replay limpos (${REMOVED} arquivos removidos, ${REPLAY_AFTER} restantes)${NC}"
fi

# Limpa arquivos de reports (mantém apenas demo-relatorio.json)
if [ -d "tests/rpa/reports" ]; then
    echo -e "${YELLOW}🗑️  Limpando arquivos de reports...${NC}"
    REPORTS_BEFORE=$(find tests/rpa/reports -type f \( -name "*.json" -o -name "*.txt" \) 2>/dev/null | wc -l)
    find tests/rpa/reports -type f \( -name "*.json" -o -name "*.txt" \) ! -name "demo-relatorio.json" -delete 2>/dev/null || true
    REPORTS_AFTER=$(find tests/rpa/reports -type f \( -name "*.json" -o -name "*.txt" \) 2>/dev/null | wc -l)
    REMOVED=$((REPORTS_BEFORE - REPORTS_AFTER))
    echo -e "${GREEN}   ✅ Arquivos de reports limpos (${REMOVED} arquivos removidos, ${REPORTS_AFTER} restantes)${NC}"
fi

# Limpa arquivos de flows gerados (mantém apenas example-test.json)
if [ -d "tests/rpa/flows" ]; then
    echo -e "${YELLOW}🗑️  Limpando arquivos de flows gerados...${NC}"
    FLOWS_BEFORE=$(find tests/rpa/flows -type f -name "*.json" 2>/dev/null | wc -l)
    find tests/rpa/flows -type f -name "*.json" ! -name "example-test.json" -delete 2>/dev/null || true
    FLOWS_AFTER=$(find tests/rpa/flows -type f -name "*.json" 2>/dev/null | wc -l)
    REMOVED=$((FLOWS_BEFORE - FLOWS_AFTER))
    echo -e "${GREEN}   ✅ Arquivos de flows limpos (${REMOVED} arquivos removidos, ${FLOWS_AFTER} restantes)${NC}"
fi

# Limpa screenshots de erros (mantém apenas arquivos de exemplo)
if [ -d "tests/rpa/screenshots" ]; then
    echo -e "${YELLOW}🗑️  Limpando screenshots de erros...${NC}"
    SCREENSHOTS_BEFORE=$(find tests/rpa/screenshots -type f -name "error-*.png" 2>/dev/null | wc -l)
    find tests/rpa/screenshots -type f -name "error-*.png" -delete 2>/dev/null || true
    SCREENSHOTS_AFTER=$(find tests/rpa/screenshots -type f -name "error-*.png" 2>/dev/null | wc -l)
    REMOVED=$((SCREENSHOTS_BEFORE - SCREENSHOTS_AFTER))
    echo -e "${GREEN}   ✅ Screenshots de erros limpos (${REMOVED} arquivos removidos, ${SCREENSHOTS_AFTER} restantes)${NC}"
fi

# Limpa arquivos de execuções se existir o diretório
if [ -d "data/executions" ]; then
    echo -e "${YELLOW}🗑️  Limpando arquivos de execuções...${NC}"
    EXECUTIONS_BEFORE=$(find data/executions -type f -name "*.json" 2>/dev/null | wc -l)
    find data/executions -type f -name "*.json" -delete 2>/dev/null || true
    EXECUTIONS_AFTER=$(find data/executions -type f -name "*.json" 2>/dev/null | wc -l)
    REMOVED=$((EXECUTIONS_BEFORE - EXECUTIONS_AFTER))
    echo -e "${GREEN}   ✅ Arquivos de execuções limpos (${REMOVED} arquivos removidos, ${EXECUTIONS_AFTER} restantes)${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 RESUMO DA LIMPEZA${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "${GREEN}✅ Containers Docker: Parados e removidos${NC}"
echo -e "${GREEN}✅ Volumes Docker: Removidos${NC}"
echo -e "${GREEN}✅ Serviços systemd: Parados${NC}"
echo -e "${GREEN}✅ Processos: Limpos${NC}"
echo -e "${GREEN}✅ Cache Redis: Limpo${NC}"
echo -e "${GREEN}✅ Dados JSON: Resetados (tenant: ${DEFAULT_TENANT})${NC}"
echo -e "${GREEN}✅ Arquivos de testes RPA: Limpos${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🎯 PRÓXIMOS PASSOS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "${YELLOW}Para reiniciar a plataforma:${NC}"
echo -e "${GREEN}  Desenvolvimento:${NC}"
echo -e "    docker-compose up -d"
echo ""
echo -e "${GREEN}  Produção:${NC}"
echo -e "    docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo -e "${GREEN}  Serviços systemd:${NC}"
echo -e "    npm run services:start"
echo ""
echo -e "${GREEN}  Ou use o script completo:${NC}"
echo -e "    ./scripts/reset-all.sh ${DEFAULT_TENANT} --restart"

echo ""
echo -e "${GREEN}✅ Reset completo concluído com sucesso!${NC}"
echo ""
