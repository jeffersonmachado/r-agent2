#!/bin/bash

# Script para iniciar API, Frontend e RAG Service juntos em desenvolvimento

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Iniciando servidores de desenvolvimento...${NC}"

# Função para verificar se porta está em uso
check_port() {
    local port=$1
    local in_use=false
    
    # Método 1: lsof
    if command -v lsof &> /dev/null; then
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            in_use=true
        fi
    fi
    
    # Método 2: fuser (se lsof não encontrou nada)
    if [ "$in_use" = false ] && command -v fuser &> /dev/null; then
        if fuser $port/tcp >/dev/null 2>&1; then
            in_use=true
        fi
    fi
    
    # Método 3: netstat (fallback)
    if [ "$in_use" = false ] && command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":$port " || netstat -tuln 2>/dev/null | grep -q ":$port "; then
            in_use=true
        fi
    fi
    
    # Método 4: ss (fallback moderno)
    if [ "$in_use" = false ] && command -v ss &> /dev/null; then
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            in_use=true
        fi
    fi
    
    if [ "$in_use" = true ]; then
        return 0  # Porta em uso
    else
        return 1  # Porta livre
    fi
}

# Função para matar processos que estão usando uma porta
kill_port() {
    local port=$1
    local service_name=$2
    
    if check_port $port; then
        echo -e "${YELLOW}Porta $port ($service_name) está em uso.${NC}"
        
        # Mostra o que está rodando na porta
        echo -e "${BLUE}Processos usando a porta $port:${NC}"
        if command -v lsof &> /dev/null; then
            lsof -i :$port 2>/dev/null | head -10 || echo "  (nenhum processo encontrado via lsof)"
        else
            echo "  (lsof não disponível)"
        fi
        if command -v fuser &> /dev/null; then
            fuser $port/tcp 2>/dev/null | head -5 || echo "  (nenhum processo encontrado via fuser)"
        else
            echo "  (fuser não disponível)"
        fi
        
        echo -e "${YELLOW}Matando processos...${NC}"
        
        # Tenta matar usando lsof
        if command -v lsof &> /dev/null; then
            local pids=$(lsof -ti :$port 2>/dev/null)
            if [ -n "$pids" ]; then
                echo -e "${BLUE}  Matando PIDs: $pids${NC}"
                echo "$pids" | xargs kill -9 2>/dev/null
                sleep 1
            fi
        fi
        
        # Tenta matar usando fuser
        if command -v fuser &> /dev/null; then
            fuser -k $port/tcp >/dev/null 2>&1
            sleep 1
        fi
        
        # Tenta matar usando netstat/ss + ps
        if command -v netstat &> /dev/null; then
            local netstat_pids=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' | sort -u)
            if [ -n "$netstat_pids" ]; then
                echo -e "${BLUE}  Matando PIDs encontrados via netstat: $netstat_pids${NC}"
                echo "$netstat_pids" | xargs kill -9 2>/dev/null
                sleep 1
            fi
        fi
        
        if command -v ss &> /dev/null; then
            local ss_pids=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oE 'pid=[0-9]+' | cut -d'=' -f2 | sort -u)
            if [ -n "$ss_pids" ]; then
                echo -e "${BLUE}  Matando PIDs encontrados via ss: $ss_pids${NC}"
                echo "$ss_pids" | xargs kill -9 2>/dev/null
                sleep 1
            fi
        fi
        
        # Verifica se há containers Docker usando a porta
        if command -v docker &> /dev/null; then
            docker_containers=$(docker ps --filter "publish=$port" --format "{{.ID}}" 2>/dev/null)
            if [ -n "$docker_containers" ]; then
                echo -e "${BLUE}  Encontrados containers Docker na porta $port:${NC}"
                docker ps --filter "publish=$port" --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}" 2>/dev/null | sed 's/^/    /'
                echo -e "${YELLOW}  Parando containers Docker...${NC}"
                echo "$docker_containers" | xargs docker stop 2>/dev/null
                sleep 2
            fi
        fi
        
        # Verifica se ainda está em uso
        if check_port $port; then
            echo -e "${YELLOW}⚠️  Porta $port ainda está em uso após tentativas de liberação${NC}"
            echo -e "${YELLOW}   O script continuará tentando liberar a porta...${NC}"
            return 1
        else
            echo -e "${GREEN}✅ Porta $port liberada${NC}"
            return 0
        fi
    else
        echo -e "${GREEN}Porta $port ($service_name) está livre${NC}"
        return 0
    fi
}

# Função para limpar processos ao sair
cleanup() {
    echo -e "\n${BLUE}Parando servidores...${NC}"
    kill $API_PID $FRONTEND_PID $RAG_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Detecta diretório do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAG_SERVICE_DIR="${RAG_SERVICE_DIR:-$PROJECT_ROOT/rag-service}"
RAG_PORT=8001

read_config() {
    local expr="$1"
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('api/data/config.json', 'utf8'));
const read = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
const value = read(config, process.argv[1]);
if (value === undefined || value === null) process.exit(1);
if (typeof value === 'object') {
  process.stdout.write(JSON.stringify(value));
} else {
  process.stdout.write(String(value));
}
" "$expr" 2>/dev/null
}

RAG_ENABLED=true

RAG_PORT_FROM_CONFIG="$(read_config 'rag.port')"
if [ -n "$RAG_PORT_FROM_CONFIG" ]; then
    RAG_PORT="$RAG_PORT_FROM_CONFIG"
else
    RAG_SERVICE_URL="$(read_config 'rag.serviceUrl')"
    if [ -n "$RAG_SERVICE_URL" ]; then
        RAG_PORT_FROM_URL="$(echo "$RAG_SERVICE_URL" | sed -n 's/.*:\([0-9]*\).*/\1/p')"
        if [ -n "$RAG_PORT_FROM_URL" ]; then
            RAG_PORT="$RAG_PORT_FROM_URL"
        fi
    fi
fi

normalize_local_service_urls() {
    if [ -n "${RAG_SERVICE_URL:-}" ] && echo "$RAG_SERVICE_URL" | grep -qE '://rag-service(:|/|$)'; then
        export RAG_SERVICE_URL="http://localhost:${RAG_PORT}"
        echo -e "${YELLOW}RAG_SERVICE_URL apontava para alias Docker. Ajustado para: $RAG_SERVICE_URL${NC}"
    fi

    local redis_host_port="${REDIS_HOST_PORT:-6379}"

    if [ -n "${REDIS_URL:-}" ] && echo "$REDIS_URL" | grep -qE '^redis://redis(:|/|$)'; then
        export REDIS_URL="redis://localhost:${redis_host_port}"
        echo -e "${YELLOW}REDIS_URL apontava para alias Docker. Ajustado para: $REDIS_URL${NC}"
    fi

    if [ -n "${RATE_LIMIT_REDIS_URL:-}" ] && echo "$RATE_LIMIT_REDIS_URL" | grep -qE '^redis://redis(:|/|$)'; then
        export RATE_LIMIT_REDIS_URL="redis://localhost:${redis_host_port}"
        echo -e "${YELLOW}RATE_LIMIT_REDIS_URL apontava para alias Docker. Ajustado para: $RATE_LIMIT_REDIS_URL${NC}"
    fi
}

normalize_local_service_urls

# Função para matar processos relacionados ao projeto
kill_project_processes() {
    echo -e "${YELLOW}Matando processos relacionados ao projeto...${NC}"
    
    # Mata processos nodemon relacionados ao server.js no diretório do projeto
    local nodemon_pids=$(ps aux | grep -E "nodemon.*server.js" | grep "$PROJECT_ROOT" | grep -v grep | awk '{print $2}')
    if [ -n "$nodemon_pids" ]; then
        echo -e "${BLUE}  Encontrados processos nodemon:${NC}"
        ps aux | grep -E "nodemon.*server.js" | grep "$PROJECT_ROOT" | grep -v grep | awk '{print "    PID", $2, "-", $11, $12, $13, $14}'
        echo "$nodemon_pids" | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    # Mata processos node relacionados ao server.js no diretório do projeto
    local node_pids=$(ps aux | grep -E "node.*server.js" | grep "$PROJECT_ROOT" | grep -v grep | awk '{print $2}')
    if [ -n "$node_pids" ]; then
        echo -e "${BLUE}  Encontrados processos node:${NC}"
        ps aux | grep -E "node.*server.js" | grep "$PROJECT_ROOT" | grep -v grep | awk '{print "    PID", $2, "-", $11, $12, $13, $14}'
        echo "$node_pids" | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    # Mata processos uvicorn do RAG service no diretório do projeto
    local uvicorn_pids=$(ps aux | grep "uvicorn main:app" | grep "$RAG_SERVICE_DIR" | grep -v grep | awk '{print $2}')
    if [ -n "$uvicorn_pids" ]; then
        echo -e "${BLUE}  Encontrados processos uvicorn (RAG Service):${NC}"
        ps aux | grep "uvicorn main:app" | grep "$RAG_SERVICE_DIR" | grep -v grep | awk '{print "    PID", $2, "-", $11, $12, $13, $14, $15}'
        echo "$uvicorn_pids" | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    # Mata processos usando a porta do RAG Service
    port_rag_pids=""
    if command -v lsof &> /dev/null; then
        port_rag_pids=$(lsof -ti :$RAG_PORT 2>/dev/null)
    fi
    if [ -z "$port_rag_pids" ] && command -v netstat &> /dev/null; then
        port_rag_pids=$(sudo netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ')
    fi
    if [ -z "$port_rag_pids" ] && command -v ss &> /dev/null; then
        port_rag_pids=$(ss -tlnp 2>/dev/null | grep ":$RAG_PORT " | grep -oE 'pid=[0-9]+' | cut -d'=' -f2 | sort -u | tr '\n' ' ')
    fi
    
    if [ -n "$port_rag_pids" ]; then
        echo -e "${BLUE}  Encontrados processos na porta $RAG_PORT:${NC}"
        if command -v lsof &> /dev/null; then
            lsof -i :$RAG_PORT 2>/dev/null | head -5 || echo "    (lsof não disponível)"
        fi
        if command -v netstat &> /dev/null; then
            sudo netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " | head -3 || echo "    (netstat não disponível)"
        fi
        echo -e "${BLUE}  Matando PIDs: $port_rag_pids${NC}"
        echo "$port_rag_pids" | xargs kill -9 2>/dev/null
        if command -v fuser &> /dev/null; then
            fuser -k $RAG_PORT/tcp >/dev/null 2>&1
        fi
        sleep 1
    fi
    
    # Verifica se há containers Docker usando a porta do RAG Service
    if command -v docker &> /dev/null; then
        docker_containers=$(docker ps --filter "publish=$RAG_PORT" --format "{{.ID}}" 2>/dev/null)
        if [ -n "$docker_containers" ]; then
            echo -e "${BLUE}  Encontrados containers Docker na porta $RAG_PORT:${NC}"
            docker ps --filter "publish=$RAG_PORT" --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}" 2>/dev/null | sed 's/^/    /'
            echo -e "${YELLOW}  Parando containers Docker...${NC}"
            echo "$docker_containers" | xargs docker stop 2>/dev/null
            sleep 2
        fi
    fi
    
    # Mata processos do frontend (vite) no diretório do projeto
    local frontend_pids=$(ps aux | grep -E "vite|npm.*start" | grep "$PROJECT_ROOT/frontend" | grep -v grep | awk '{print $2}')
    if [ -n "$frontend_pids" ]; then
        echo -e "${BLUE}  Encontrados processos frontend:${NC}"
        ps aux | grep -E "vite|npm.*start" | grep "$PROJECT_ROOT/frontend" | grep -v grep | awk '{print "    PID", $2, "-", $11, $12, $13, $14}'
        echo "$frontend_pids" | xargs kill -9 2>/dev/null
        sleep 1
    fi
    
    # Verifica e para containers Docker usando portas do projeto
    if command -v docker &> /dev/null; then
        # Porta do RAG Service
        docker_rag=$(docker ps --filter "publish=$RAG_PORT" --format "{{.ID}}" 2>/dev/null)
        if [ -n "$docker_rag" ]; then
            echo -e "${BLUE}  Encontrados containers Docker na porta $RAG_PORT:${NC}"
            docker ps --filter "publish=$RAG_PORT" --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}" 2>/dev/null | sed 's/^/    /'
            echo -e "${YELLOW}  Parando containers Docker na porta $RAG_PORT...${NC}"
            echo "$docker_rag" | xargs docker stop 2>/dev/null
            sleep 1
        fi
        
        # Porta da API (será lida do config.json depois, mas tenta 3001 e 3000 para compatibilidade)
        for api_port in 3001 3000; do
            docker_api=$(docker ps --filter "publish=$api_port" --format "{{.ID}}" 2>/dev/null)
            if [ -n "$docker_api" ]; then
                echo -e "${BLUE}  Encontrados containers Docker na porta $api_port:${NC}"
                docker ps --filter "publish=$api_port" --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}" 2>/dev/null | sed 's/^/    /'
                echo -e "${YELLOW}  Parando containers Docker na porta $api_port...${NC}"
                echo "$docker_api" | xargs docker stop 2>/dev/null
                sleep 1
            fi
        done
    fi
    
    if [ -z "$nodemon_pids" ] && [ -z "$node_pids" ] && [ -z "$uvicorn_pids" ] && [ -z "$port_rag_pids" ] && [ -z "$frontend_pids" ]; then
        echo -e "${GREEN}  Nenhum processo relacionado ao projeto encontrado${NC}"
    fi
}

# Mata processos relacionados ao projeto antes de iniciar
kill_project_processes

# Inicializa banco de dados PostgreSQL (inicia serviço + cria banco + migrations + seed)
echo -e "${BLUE}Inicializando banco de dados PostgreSQL...${NC}"
cd "$PROJECT_ROOT"

# Carrega variáveis do .env se existir
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | grep -v '^$' | xargs 2>/dev/null)
fi

# Garante runtime externo ao workspace para evitar crash da API
PROJECT_ROOT_ABS="$(cd "$PROJECT_ROOT" && pwd -P)"

if [ -z "$RUNTIME_ROOT" ]; then
    RUNTIME_ROOT="/tmp/ragent2-runtime-dev"
    echo -e "${YELLOW}RUNTIME_ROOT não definido. Usando padrão: $RUNTIME_ROOT${NC}"
fi

mkdir -p "$RUNTIME_ROOT" 2>/dev/null || true
RUNTIME_ROOT_ABS="$(cd "$RUNTIME_ROOT" 2>/dev/null && pwd -P)"

if [ -z "$RUNTIME_ROOT_ABS" ]; then
    RUNTIME_ROOT="/tmp/ragent2-runtime-dev"
    mkdir -p "$RUNTIME_ROOT"
    RUNTIME_ROOT_ABS="$(cd "$RUNTIME_ROOT" && pwd -P)"
fi

case "$RUNTIME_ROOT_ABS" in
    "$PROJECT_ROOT_ABS"|"$PROJECT_ROOT_ABS"/*)
        RUNTIME_ROOT="/tmp/ragent2-runtime-dev"
        mkdir -p "$RUNTIME_ROOT"
        RUNTIME_ROOT_ABS="$(cd "$RUNTIME_ROOT" && pwd -P)"
        echo -e "${YELLOW}RUNTIME_ROOT apontava para dentro do workspace. Ajustado para: $RUNTIME_ROOT_ABS${NC}"
        ;;
esac

export RUNTIME_ROOT="$RUNTIME_ROOT_ABS"
echo -e "${GREEN}✅ RUNTIME_ROOT ativo: $RUNTIME_ROOT${NC}"

PGDATABASE=${PGDATABASE:-r_agent2}
PGHOST=${PGHOST:-localhost}
PGUSER=${PGUSER:-postgres}
PGPASSWORD=${PGPASSWORD:-}
PGPORT=${PGPORT:-5432}

# Exporta PGPASSWORD para uso pelo psql
if [ -n "$PGPASSWORD" ]; then
    export PGPASSWORD
fi

# Função para verificar se PostgreSQL está respondendo
check_postgres_responding() {
    if [ -n "$PGPASSWORD" ]; then
        PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d postgres -c "SELECT 1;" &>/dev/null
    else
        sudo -u postgres psql -c "SELECT 1;" &>/dev/null 2>&1
    fi
}

# 0. Garante que PostgreSQL está rodando
echo -e "${BLUE}Verificando serviço PostgreSQL...${NC}"

# Função para encontrar o nome do serviço PostgreSQL
find_postgres_service() {
    local service_name=""
    
    # Lista de possíveis nomes de serviço do PostgreSQL
    local possible_services=("postgresql" "postgres" "postgresql@14-main" "postgresql@15-main" "postgresql@16-main" "postgresql@13-main" "postgresql@12-main")
    
    for svc in "${possible_services[@]}"; do
        if systemctl list-unit-files | grep -q "^${svc}\." 2>/dev/null; then
            if systemctl is-enabled "${svc}" &>/dev/null || systemctl is-active "${svc}" &>/dev/null 2>/dev/null; then
                service_name="$svc"
                break
            fi
        fi
    done
    
    # Se não encontrou, tenta padrões com wildcard
    if [ -z "$service_name" ]; then
        for svc in postgresql postgresql@* postgres; do
            if systemctl is-active --quiet "$svc" 2>/dev/null; then
                service_name="$svc"
                break
            fi
        done
    fi
    
    echo "$service_name"
}

# Verifica se PostgreSQL está respondendo primeiro
if check_postgres_responding; then
    echo -e "${GREEN}✅ PostgreSQL está respondendo${NC}"
else
    # PostgreSQL não está respondendo, verifica se o serviço está rodando
    POSTGRES_RUNNING=false
    
    if command -v systemctl &> /dev/null; then
        # Tenta encontrar o nome do serviço
        PG_SERVICE=$(find_postgres_service)
        
        if [ -n "$PG_SERVICE" ]; then
            # Verifica se o serviço está ativo
            if systemctl is-active --quiet "$PG_SERVICE" 2>/dev/null; then
                POSTGRES_RUNNING=true
                echo -e "${YELLOW}⚠️  Serviço PostgreSQL está ativo mas não está respondendo${NC}"
                echo -e "${YELLOW}   Aguardando PostgreSQL ficar pronto...${NC}"
            else
                # Serviço existe mas não está rodando, tenta iniciar
                echo -e "${YELLOW}PostgreSQL não está rodando, iniciando serviço '$PG_SERVICE'...${NC}"
                if sudo systemctl start "$PG_SERVICE" 2>/dev/null; then
                    echo -e "${GREEN}✅ Serviço PostgreSQL iniciado${NC}"
                    sleep 3
                    POSTGRES_RUNNING=true
                else
                    echo -e "${RED}❌ Erro ao iniciar PostgreSQL${NC}"
                    echo -e "${YELLOW}💡 Tente iniciar manualmente: sudo systemctl start $PG_SERVICE${NC}"
                fi
            fi
        else
            # Não encontrou o serviço, tenta nomes comuns
            echo -e "${YELLOW}Procurando serviço PostgreSQL...${NC}"
            for svc in postgresql postgres; do
                if systemctl list-unit-files | grep -q "^${svc}\." 2>/dev/null; then
                    echo -e "${BLUE}Tentando iniciar serviço '$svc'...${NC}"
                    if sudo systemctl start "$svc" 2>/dev/null; then
                        echo -e "${GREEN}✅ Serviço '$svc' iniciado${NC}"
                        sleep 3
                        POSTGRES_RUNNING=true
                        break
                    fi
                fi
            done
            
            if [ "$POSTGRES_RUNNING" = false ]; then
                echo -e "${RED}❌ Não foi possível encontrar ou iniciar o serviço PostgreSQL${NC}"
                echo -e "${YELLOW}💡 Verifique se PostgreSQL está instalado:${NC}"
                echo -e "${YELLOW}   sudo apt-get install postgresql postgresql-contrib${NC}"
                echo -e "${YELLOW}   ou${NC}"
                echo -e "${YELLOW}   sudo systemctl status postgresql${NC}"
            fi
        fi
    elif command -v service &> /dev/null; then
        # Fallback para service command
        if service postgresql status &>/dev/null | grep -qE "active|running"; then
            POSTGRES_RUNNING=true
            echo -e "${YELLOW}⚠️  Serviço PostgreSQL está ativo mas não está respondendo${NC}"
        else
            echo -e "${YELLOW}PostgreSQL não está rodando, iniciando...${NC}"
            if sudo service postgresql start 2>/dev/null; then
                echo -e "${GREEN}✅ Serviço PostgreSQL iniciado${NC}"
                sleep 3
                POSTGRES_RUNNING=true
            else
                echo -e "${RED}❌ Erro ao iniciar PostgreSQL${NC}"
                echo -e "${YELLOW}💡 Tente iniciar manualmente: sudo service postgresql start${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}⚠️  systemctl/service não encontrado, assumindo que PostgreSQL está rodando${NC}"
        POSTGRES_RUNNING=true
    fi
fi

# Aguarda PostgreSQL estar pronto (se não estava respondendo antes)
if ! check_postgres_responding; then
    echo -e "${BLUE}Aguardando PostgreSQL estar pronto...${NC}"
    POSTGRES_READY=false
    for i in {1..30}; do
        if check_postgres_responding; then
            echo -e "${GREEN}✅ PostgreSQL está pronto${NC}"
            POSTGRES_READY=true
            break
        fi
        
        if [ $i -eq 30 ]; then
            echo -e "${YELLOW}⚠️  PostgreSQL não respondeu após 30 tentativas${NC}"
            echo -e "${YELLOW}💡 Verifique se o serviço está rodando: sudo systemctl status postgresql${NC}"
        else
            sleep 1
        fi
    done
    
    if [ "$POSTGRES_READY" = false ]; then
        echo -e "${RED}❌ Não foi possível conectar ao PostgreSQL${NC}"
        echo -e "${YELLOW}💡 O servidor continuará iniciando, mas pode falhar ao conectar ao banco${NC}"
    fi
fi

# 1. Cria banco de dados se não existir
if command -v psql &> /dev/null; then
    # Tenta verificar se o banco existe
    DB_EXISTS="0"
    
    if [ -n "$PGPASSWORD" ]; then
        # Usa PGPASSWORD para conectar diretamente
        DB_EXISTS=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'" 2>/dev/null || echo "0")
    else
        # Usa sudo -u postgres
        DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'" 2>/dev/null || echo "0")
    fi
    
    if [ "$DB_EXISTS" != "1" ]; then
        echo -e "${YELLOW}Criando banco de dados '$PGDATABASE'...${NC}"
        
        if [ -n "$PGPASSWORD" ]; then
            # Usa PGPASSWORD para criar banco
            if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -p "$PGPORT" -d postgres -c "CREATE DATABASE \"$PGDATABASE\";" 2>/dev/null; then
                echo -e "${GREEN}✅ Banco de dados '$PGDATABASE' criado com sucesso!${NC}"
            else
                echo -e "${YELLOW}⚠️  Não foi possível criar banco com PGPASSWORD${NC}"
                echo -e "${YELLOW}💡 Verifique se PGPASSWORD está correto no .env${NC}"
            fi
        else
            # Usa sudo -u postgres
            if sudo -u postgres psql -c "CREATE DATABASE \"$PGDATABASE\";" 2>/dev/null; then
                echo -e "${GREEN}✅ Banco de dados '$PGDATABASE' criado com sucesso!${NC}"
            else
                echo -e "${YELLOW}⚠️  Não foi possível criar banco${NC}"
                echo -e "${YELLOW}💡 Tente criar manualmente: sudo -u postgres psql -c \"CREATE DATABASE $PGDATABASE;\"${NC}"
            fi
        fi
    else
        echo -e "${GREEN}✅ Banco de dados '$PGDATABASE' já existe${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  psql não encontrado, pulando verificação do banco${NC}"
fi

# 2. Executa migrations
echo -e "${BLUE}Executando migrations...${NC}"
if node api/db/migrate.js; then
    echo -e "${GREEN}✅ Migrations executadas com sucesso${NC}"
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✅ Migrations executadas com sucesso${NC}"
    else
        echo -e "${YELLOW}⚠️  Aviso: Erro ao executar migrations (código: $EXIT_CODE)${NC}"
        echo -e "${YELLOW}💡 Verifique manualmente: node api/db/migrate.js${NC}"
        echo -e "${YELLOW}   O servidor continuará iniciando mesmo assim...${NC}"
    fi
fi

# 3. Executa seed
echo -e "${BLUE}Executando seed...${NC}"
if node api/db/seed.js; then
    echo -e "${GREEN}✅ Seed executado com sucesso${NC}"
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✅ Seed executado com sucesso${NC}"
    else
        echo -e "${YELLOW}⚠️  Aviso: Erro ao executar seed (código: $EXIT_CODE)${NC}"
        echo -e "${YELLOW}💡 Verifique manualmente: node api/db/seed.js${NC}"
        echo -e "${YELLOW}   O servidor continuará iniciando mesmo assim...${NC}"
    fi
fi

echo -e "${GREEN}✅ Inicialização do banco de dados concluída${NC}"
echo ""

# Lê porta da API (variável de ambiente tem precedência sobre config.json)
API_PORT=3001

# Primeiro tenta ler da variável de ambiente
if [ -n "$API_PORT_ENV" ]; then
    API_PORT=$API_PORT_ENV
# Se não houver variável de ambiente, lê do config.json
elif [ -f "api/data/config.json" ]; then
    # Procura especificamente dentro da seção "api"
    CONFIG_API_PORT=$(grep -A 5 '"api"' api/data/config.json | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$CONFIG_API_PORT" ]; then
        API_PORT=$CONFIG_API_PORT
    fi
fi

# Mata processos na porta da API se estiver em uso
kill_port $API_PORT "API"

# Inicia a API com nodemon em background (para auto-reload)
echo -e "${GREEN}Iniciando API com nodemon na porta $API_PORT...${NC}"
npx --yes nodemon api/server.js &
API_PID=$!

# Aguarda um pouco para a API iniciar
sleep 2

# Verifica se a API está rodando
if ! kill -0 $API_PID 2>/dev/null; then
    echo -e "${RED}Erro: API não iniciou corretamente${NC}"
    exit 1
fi

# Lê porta do frontend (variável de ambiente tem precedência sobre config.json)
FRONTEND_PORT=5173

# Primeiro tenta ler da variável de ambiente
if [ -n "$FRONTEND_PORT_ENV" ]; then
    FRONTEND_PORT=$FRONTEND_PORT_ENV
# Se não houver variável de ambiente, lê do config.json
elif [ -f "api/data/config.json" ]; then
    # Procura especificamente dentro da seção "frontend"
    CONFIG_PORT=$(grep -A 5 '"frontend"' api/data/config.json | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$CONFIG_PORT" ]; then
        FRONTEND_PORT=$CONFIG_PORT
    fi
fi

if [ "$RAG_ENABLED" = "true" ]; then
    # Mata processos na porta do RAG se estiver em uso
    if ! kill_port $RAG_PORT "RAG Service"; then
        echo -e "${YELLOW}⚠️  kill_port retornou erro, mas continuando...${NC}"
    fi

    # Aguarda a porta ficar livre (máximo 10 segundos)
    echo -e "${BLUE}Aguardando porta $RAG_PORT ficar livre...${NC}"
    PORT_FREE=false
    for i in {1..10}; do
        if ! check_port $RAG_PORT; then
            PORT_FREE=true
            break
        fi
        if [ $i -eq 1 ] || [ $i -eq 5 ] || [ $i -eq 10 ]; then
            echo -e "${YELLOW}  Tentativa $i/10 - Porta ainda em uso:${NC}"
            # Tenta mostrar processos usando todos os métodos disponíveis
            found_process=false
            
            if command -v lsof &> /dev/null; then
                lsof_output=$(lsof -i :$RAG_PORT 2>/dev/null)
                if [ -n "$lsof_output" ]; then
                    echo -e "${BLUE}    Processos encontrados via lsof:${NC}"
                    echo "$lsof_output" | head -5 | sed 's/^/      /'
                    found_process=true
                fi
            fi
            
            if [ "$found_process" = false ] && command -v netstat &> /dev/null; then
                netstat_output=$(netstat -tlnp 2>/dev/null | grep ":$RAG_PORT ")
                if [ -n "$netstat_output" ]; then
                    echo -e "${BLUE}    Processos encontrados via netstat:${NC}"
                    echo "$netstat_output" | head -3 | sed 's/^/      /'
                    found_process=true
                fi
            fi
            
            if [ "$found_process" = false ] && command -v ss &> /dev/null; then
                ss_output=$(ss -tlnp 2>/dev/null | grep ":$RAG_PORT ")
                if [ -n "$ss_output" ]; then
                    echo -e "${BLUE}    Processos encontrados via ss:${NC}"
                    echo "$ss_output" | head -3 | sed 's/^/      /'
                    found_process=true
                fi
            fi
            
            if [ "$found_process" = false ]; then
                echo -e "${YELLOW}    (nenhum processo encontrado, pode ser socket TIME_WAIT)${NC}"
            fi
        fi
        sleep 1
    done

if [ "$PORT_FREE" = false ]; then
    echo -e "${YELLOW}⚠️  Porta $RAG_PORT ainda está em uso após 10 segundos${NC}"
    echo -e "${YELLOW}   Processos ainda usando a porta:${NC}"
    
    # Tenta mostrar processos usando todos os métodos
    found_any=false
    
    if command -v lsof &> /dev/null; then
        lsof_output=$(lsof -i :$RAG_PORT 2>/dev/null)
        if [ -n "$lsof_output" ]; then
            echo -e "${BLUE}    Via lsof:${NC}"
            echo "$lsof_output" | head -5 | sed 's/^/      /'
            found_any=true
        fi
    fi
    
    if command -v netstat &> /dev/null; then
        netstat_output=$(netstat -tlnp 2>/dev/null | grep ":$RAG_PORT ")
        if [ -n "$netstat_output" ]; then
            echo -e "${BLUE}    Via netstat:${NC}"
            echo "$netstat_output" | head -3 | sed 's/^/      /'
            found_any=true
        fi
    fi
    
    if command -v ss &> /dev/null; then
        ss_output=$(ss -tlnp 2>/dev/null | grep ":$RAG_PORT ")
        if [ -n "$ss_output" ]; then
            echo -e "${BLUE}    Via ss:${NC}"
            echo "$ss_output" | head -3 | sed 's/^/      /'
            found_any=true
        fi
    fi
    
    if command -v fuser &> /dev/null; then
        fuser_output=$(fuser $RAG_PORT/tcp 2>&1)
        if [ $? -eq 0 ] && [ -n "$fuser_output" ]; then
            echo -e "${BLUE}    Via fuser:${NC}"
            echo "$fuser_output" | sed 's/^/      /'
            found_any=true
        fi
    fi
    
    if [ "$found_any" = false ]; then
        echo -e "${YELLOW}    (nenhum processo encontrado - pode ser socket TIME_WAIT)${NC}"
        echo -e "${YELLOW}    Socket TIME_WAIT geralmente é liberado automaticamente em 30-60 segundos${NC}"
    fi
    
    echo -e "${YELLOW}   Tentando forçar liberação...${NC}"
    # Tenta matar novamente de forma mais agressiva usando todos os métodos disponíveis
    remaining_pids=""
    
    if command -v lsof &> /dev/null; then
        remaining_pids=$(lsof -ti :$RAG_PORT 2>/dev/null)
    fi
    
    if [ -z "$remaining_pids" ] && command -v netstat &> /dev/null; then
        # Tenta com sudo primeiro para ver PIDs de processos de outros usuários
        remaining_pids=$(sudo netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ')
        if [ -z "$remaining_pids" ]; then
            # Tenta sem sudo
            remaining_pids=$(netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ')
        fi
    fi
    
    if [ -z "$remaining_pids" ] && command -v ss &> /dev/null; then
        remaining_pids=$(ss -tlnp 2>/dev/null | grep ":$RAG_PORT " | grep -oE 'pid=[0-9]+' | cut -d'=' -f2 | sort -u | tr '\n' ' ')
    fi
    
    if [ -n "$remaining_pids" ]; then
        echo -e "${BLUE}  Matando PIDs restantes: $remaining_pids${NC}"
        # Tenta matar sem sudo primeiro
        echo "$remaining_pids" | xargs kill -9 2>/dev/null
        # Se não funcionou, tenta com sudo (pode precisar de senha)
        if check_port $RAG_PORT; then
            echo -e "${YELLOW}  Tentando com sudo (pode pedir senha)...${NC}"
            echo "$remaining_pids" | xargs sudo kill -9 2>/dev/null
        fi
    fi
    
    if command -v fuser &> /dev/null; then
        echo -e "${BLUE}  Tentando matar via fuser...${NC}"
        fuser -k $RAG_PORT/tcp >/dev/null 2>&1
    fi
    
    # Verifica containers Docker
    if command -v docker &> /dev/null; then
        docker_containers=$(docker ps --filter "publish=$RAG_PORT" --format "{{.ID}}" 2>/dev/null)
        if [ -n "$docker_containers" ]; then
            echo -e "${BLUE}  Parando containers Docker na porta $RAG_PORT...${NC}"
            echo "$docker_containers" | xargs docker stop 2>/dev/null
        fi
    fi
    
    sleep 2
fi

# Verifica uma última vez se a porta está livre
if check_port $RAG_PORT; then
    echo -e "${RED}❌ Erro: Porta $RAG_PORT ainda está em uso${NC}"
    echo -e "${YELLOW}Processos ainda usando a porta $RAG_PORT:${NC}"
    if command -v lsof &> /dev/null; then
        lsof -i :$RAG_PORT 2>/dev/null || echo "  (nenhum processo encontrado via lsof)"
    else
        echo "  (lsof não disponível)"
    fi
    if command -v fuser &> /dev/null; then
        fuser $RAG_PORT/tcp 2>/dev/null || echo "  (nenhum processo encontrado via fuser)"
    else
        echo "  (fuser não disponível)"
    fi
    if command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " || echo "  (nenhum processo encontrado via netstat)"
    fi
    if command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep ":$RAG_PORT " || echo "  (nenhum processo encontrado via ss)"
    fi
    echo -e "${YELLOW}💡 Tente matar manualmente:${NC}"
    if command -v lsof &> /dev/null; then
        echo -e "${YELLOW}   lsof -ti :$RAG_PORT | xargs kill -9${NC}"
    fi
    if command -v fuser &> /dev/null; then
        echo -e "${YELLOW}   fuser -k $RAG_PORT/tcp${NC}"
    fi
    exit 1
fi

# Aguarda um pouco mais para garantir que sockets TIME_WAIT sejam liberados
echo -e "${BLUE}Aguardando liberação completa da porta $RAG_PORT (2 segundos)...${NC}"
sleep 2

# Verificação final imediatamente antes de iniciar
echo -e "${BLUE}Verificação final da porta $RAG_PORT antes de iniciar...${NC}"
if check_port $RAG_PORT; then
    echo -e "${RED}❌ Erro: Porta $RAG_PORT foi ocupada novamente!${NC}"
    echo -e "${YELLOW}Processos usando a porta:${NC}"
    if command -v lsof &> /dev/null; then
        lsof -i :$RAG_PORT 2>/dev/null || echo "  (nenhum processo encontrado via lsof)"
    else
        echo "  (lsof não disponível)"
    fi
    if command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " || echo "  (nenhum processo encontrado via netstat)"
    fi
    if command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep ":$RAG_PORT " || echo "  (nenhum processo encontrado via ss)"
    fi
    # Tenta matar novamente usando todos os métodos
    final_pids=""
    if command -v lsof &> /dev/null; then
        final_pids=$(lsof -ti :$RAG_PORT 2>/dev/null)
    fi
    if [ -z "$final_pids" ] && command -v netstat &> /dev/null; then
        final_pids=$(netstat -tlnp 2>/dev/null | grep ":$RAG_PORT " | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ')
    fi
    if [ -z "$final_pids" ] && command -v ss &> /dev/null; then
        final_pids=$(ss -tlnp 2>/dev/null | grep ":$RAG_PORT " | grep -oE 'pid=[0-9]+' | cut -d'=' -f2 | sort -u | tr '\n' ' ')
    fi
    
    if [ -n "$final_pids" ]; then
        echo -e "${YELLOW}  Tentando matar PIDs: $final_pids${NC}"
        echo "$final_pids" | xargs kill -9 2>/dev/null
        sleep 1
        if ! check_port $RAG_PORT; then
            echo -e "${GREEN}✅ Porta liberada após tentativa final${NC}"
        else
            echo -e "${RED}❌ Não foi possível liberar a porta${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⚠️  Porta em uso mas nenhum PID encontrado (pode ser socket TIME_WAIT)${NC}"
        echo -e "${YELLOW}   Aguardando mais 3 segundos...${NC}"
        sleep 3
        if ! check_port $RAG_PORT; then
            echo -e "${GREEN}✅ Porta liberada após espera${NC}"
        else
            echo -e "${RED}❌ Porta ainda em uso após espera${NC}"
            echo -e "${YELLOW}💡 Aguarde alguns segundos e tente novamente${NC}"
            exit 1
        fi
    fi
else
    echo -e "${GREEN}✅ Porta $RAG_PORT confirmada como livre${NC}"
fi

# Inicia o RAG Service
echo -e "${GREEN}Iniciando RAG Service na porta $RAG_PORT...${NC}"

# Navega para o diretório do serviço RAG
cd "$RAG_SERVICE_DIR"

# Verifica se há um ambiente virtual
if [ -d "venv" ]; then
    echo -e "${BLUE}Usando ambiente virtual do RAG service...${NC}"
    UVICORN_CMD="venv/bin/uvicorn"
    
    # Garante dependências atualizadas (ex.: psycopg2-binary para pgvector)
    if [ -x "venv/bin/python" ]; then
        if ! venv/bin/python -c "import psycopg2" >/dev/null 2>&1; then
            echo -e "${YELLOW}⚠️  Dependências do RAG service desatualizadas (psycopg2 ausente). Instalando requirements...${NC}"
            if [ -f "requirements.txt" ]; then
                # Python 3.12: evita builds (ex.: numpy antigo) e garante toolchain do pip atualizada
                venv/bin/python -m pip install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
                export PIP_PREFER_BINARY=1
                if ! venv/bin/python -m pip install -r requirements.txt; then
                    echo -e "${RED}❌ Falha ao instalar requirements do RAG service${NC}"
                    echo -e "${YELLOW}💡 Tente manualmente: cd $RAG_SERVICE_DIR && venv/bin/python -m pip install -r requirements.txt${NC}"
                    cd "$PROJECT_ROOT"
                    exit 1
                fi

                # Valida novamente após instalar
                if ! venv/bin/python -c "import psycopg2" >/dev/null 2>&1; then
                    echo -e "${RED}❌ Dependência crítica ainda ausente (psycopg2). Abortando.${NC}"
                    echo -e "${YELLOW}💡 Verifique o output do pip install acima.${NC}"
                    cd "$PROJECT_ROOT"
                    exit 1
                fi
            else
                echo -e "${YELLOW}⚠️  requirements.txt não encontrado em $RAG_SERVICE_DIR${NC}"
                cd "$PROJECT_ROOT"
                exit 1
            fi
        fi
    fi
elif command -v uvicorn &> /dev/null; then
    echo -e "${BLUE}Usando uvicorn do sistema...${NC}"
    UVICORN_CMD="uvicorn"
else
    echo -e "${RED}Erro: uvicorn não encontrado!${NC}"
    echo -e "${YELLOW}Instale as dependências: cd $RAG_SERVICE_DIR && pip install -r requirements.txt${NC}"
    cd "$PROJECT_ROOT"
    exit 1
fi

# Inicia o RAG service em background com reload
echo -e "${BLUE}Executando: $UVICORN_CMD main:app --reload --host 0.0.0.0 --port $RAG_PORT${NC}"
$UVICORN_CMD main:app --reload --host 0.0.0.0 --port $RAG_PORT > /tmp/rag-service-dev.log 2>&1 &
RAG_PID=$!

# Volta para o diretório raiz
cd "$PROJECT_ROOT"

# Aguarda um pouco para o processo iniciar e escrever no log
sleep 1

# Verifica imediatamente se há erro no log (como "Address already in use")
if [ -f /tmp/rag-service-dev.log ]; then
    if grep -q "Address already in use\|ERROR.*Errno 98\|OSError.*98" /tmp/rag-service-dev.log 2>/dev/null; then
        echo -e "${RED}Erro: RAG Service falhou ao iniciar (porta em uso)${NC}"
        echo -e "${YELLOW}Verificando o que está usando a porta $RAG_PORT:${NC}"
        if command -v lsof &> /dev/null; then
            lsof -i :$RAG_PORT 2>/dev/null || echo "  (nenhum processo encontrado)"
        fi
        echo -e "${YELLOW}Últimas linhas do log:${NC}"
        tail -10 /tmp/rag-service-dev.log 2>/dev/null || echo "Log não encontrado"
        # Tenta matar o processo se ainda existir
        kill $RAG_PID 2>/dev/null
        wait $RAG_PID 2>/dev/null
        exit 1
    fi
fi

# Aguarda mais um pouco para o RAG service iniciar
sleep 1

# Verifica se o processo ainda está rodando
if ! kill -0 $RAG_PID 2>/dev/null; then
    echo -e "${RED}Erro: RAG Service não iniciou corretamente (processo terminou)${NC}"
    echo -e "${YELLOW}Verificando o que está usando a porta $RAG_PORT:${NC}"
    if command -v lsof &> /dev/null; then
        lsof -i :$RAG_PORT 2>/dev/null || echo "  (nenhum processo encontrado)"
    fi
    echo -e "${YELLOW}Verifique os logs: tail -f /tmp/rag-service-dev.log${NC}"
    echo -e "${YELLOW}Últimas linhas do log:${NC}"
    tail -20 /tmp/rag-service-dev.log 2>/dev/null || echo "Log não encontrado"
    exit 1
fi

# Verifica novamente se há erro no log após o processo iniciar
if [ -f /tmp/rag-service-dev.log ]; then
    if grep -q "Address already in use\|ERROR.*Errno 98\|OSError.*98" /tmp/rag-service-dev.log 2>/dev/null; then
        echo -e "${RED}Erro: RAG Service falhou ao iniciar (porta em uso)${NC}"
        echo -e "${YELLOW}Verificando o que está usando a porta $RAG_PORT:${NC}"
        if command -v lsof &> /dev/null; then
            lsof -i :$RAG_PORT 2>/dev/null || echo "  (nenhum processo encontrado)"
        fi
        echo -e "${YELLOW}Últimas linhas do log:${NC}"
        tail -20 /tmp/rag-service-dev.log 2>/dev/null || echo "Log não encontrado"
        # Tenta matar o processo se ainda existir
        kill $RAG_PID 2>/dev/null
        wait $RAG_PID 2>/dev/null
        exit 1
    fi
fi

# Testa readiness do endpoint de health com retries para evitar falso-positivo
RAG_READY=false
for i in {1..15}; do
    if curl -fsS --max-time 2 "http://localhost:$RAG_PORT/rag/health" > /dev/null 2>&1 \
      || curl -fsS --max-time 2 "http://localhost:$RAG_PORT/health" > /dev/null 2>&1; then
        RAG_READY=true
        break
    fi
    sleep 1
done

if [ "$RAG_READY" = true ]; then
    echo -e "${GREEN}RAG Service iniciado com sucesso!${NC}"
else
    echo -e "${YELLOW}Aviso: RAG Service iniciado mas ainda não está respondendo${NC}"
    echo -e "${YELLOW}Verifique os logs: tail -f /tmp/rag-service-dev.log${NC}"
fi
else
    echo -e "${BLUE}RAG desabilitado em api/data/config.json; pulando RAG Service.${NC}"
fi

# Mata processos na porta do frontend se estiver em uso
kill_port $FRONTEND_PORT "Frontend"

# Inicia o frontend
echo -e "${GREEN}Iniciando Frontend na porta ${FRONTEND_PORT}...${NC}"
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

echo -e "${BLUE}Servidores iniciados!${NC}"
echo -e "${GREEN}API: http://localhost:${API_PORT}${NC}"
echo -e "${GREEN}Frontend: http://localhost:${FRONTEND_PORT}${NC}"
if [ "$RAG_ENABLED" = "true" ]; then
    echo -e "${GREEN}RAG Service: http://localhost:$RAG_PORT${NC}"
else
    echo -e "${BLUE}RAG Service: desabilitado${NC}"
fi

echo -e "${BLUE}Pressione Ctrl+C para parar todos os servidores${NC}"
wait
