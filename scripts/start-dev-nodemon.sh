#!/bin/bash

# Script para iniciar API (com nodemon) e Frontend (Vite) juntos em desenvolvimento

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Iniciando servidores de desenvolvimento (nodemon + Vite)...${NC}"

# Função para verificar se porta está em uso
check_port() {
    local port=$1
    # Tenta múltiplos métodos para verificar se a porta está em uso
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 || \
       fuser $port/tcp >/dev/null 2>&1 || \
       ss -tln | grep -q ":$port " || \
       netstat -tln 2>/dev/null | grep -q ":$port "; then
        return 0  # Porta em uso
    else
        return 1  # Porta livre
    fi
}

# Função para obter PID de processo usando a porta
get_port_pid() {
    local port=$1
    # Tenta múltiplos métodos
    local pid=$(lsof -ti:$port 2>/dev/null | head -1)
    if [ -z "$pid" ]; then
        # Tenta com ss (pode precisar de sudo para ver PID)
        pid=$(ss -tlnp 2>/dev/null | grep ":$port " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
    fi
    if [ -z "$pid" ]; then
        # Tenta com fuser
        pid=$(fuser $port/tcp 2>/dev/null | awk '{print $1}' | head -1)
    fi
    if [ -z "$pid" ]; then
        # Tenta com netstat
        pid=$(netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 | head -1)
    fi
    echo "$pid"
}

# Função para verificar se há processo uvicorn rodando (mesmo sem PID da porta)
check_uvicorn_running() {
    local port=$1
    # Verifica processos uvicorn
    local uvicorn_pid=$(ps aux | grep -E "(uvicorn|python.*uvicorn|python3.*uvicorn).*main:app" | grep -v grep | awk '{print $2}' | head -1)
    if [ -n "$uvicorn_pid" ]; then
        # Verifica se esse processo está usando a porta
        local port_pid=$(lsof -ti:$port -p $uvicorn_pid 2>/dev/null | head -1)
        if [ -n "$port_pid" ]; then
            echo "$uvicorn_pid"
            return 0
        fi
        # Se não conseguiu verificar a porta, mas encontrou uvicorn, assume que é ele
        echo "$uvicorn_pid"
        return 0
    fi
    echo ""
    return 1
}

# Função para limpar processos ao sair
cleanup() {
    echo -e "\n${BLUE}Parando servidores...${NC}"
    kill $API_PID $FRONTEND_PID $UVICORN_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Verifica se a porta 3000 está em uso
if check_port 3000; then
    echo -e "${YELLOW}Aviso: Porta 3000 já está em uso${NC}"
    echo -e "${YELLOW}Verificando se é a API do projeto...${NC}"
    
    # Tenta encontrar o processo
    API_PROCESS=$(ps aux | grep -E "(node|nodemon).*server.js" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ -n "$API_PROCESS" ]; then
        echo -e "${GREEN}API já está rodando (PID: $API_PROCESS)${NC}"
        echo -e "${BLUE}Usando API existente...${NC}"
        API_PID=$API_PROCESS
        USE_EXISTING_API=true
    else
        echo -e "${RED}Erro: Porta 3000 está em uso por outro processo${NC}"
        echo -e "${YELLOW}Execute: lsof -ti:3000 | xargs kill${NC}"
        echo -e "${YELLOW}Ou use uma porta diferente: API_PORT=3001 npm run dev:api${NC}"
        exit 1
    fi
else
    # Inicia a API com nodemon em background
    echo -e "${GREEN}Iniciando API com nodemon na porta 3000...${NC}"
    # Usa npx para executar nodemon (que está em devDependencies)
    npx --yes nodemon api/server.js &
    API_PID=$!
    USE_EXISTING_API=false
    
    # Aguarda um pouco para a API iniciar
    sleep 2
    
    # Verifica se a API está rodando
    if ! kill -0 $API_PID 2>/dev/null; then
        echo -e "${RED}Erro: API não iniciou corretamente${NC}"
        exit 1
    fi
fi

# Lê porta do RAG service do config.json (padrão: 9000)
RAG_PORT=9000
if [ -f "api/data/config.json" ]; then
    # Tenta extrair a porta da URL do RAG service
    RAG_SERVICE_URL=$(grep -o '"serviceUrl"[[:space:]]*:[[:space:]]*"[^"]*"' api/data/config.json | head -1 | grep -o 'http[^"]*' | head -1)
    if [ -n "$RAG_SERVICE_URL" ]; then
        # Extrai a porta da URL (ex: http://localhost:9000 -> 9000)
        EXTRACTED_PORT=$(echo "$RAG_SERVICE_URL" | sed -n 's/.*:\([0-9]*\).*/\1/p')
        if [ -n "$EXTRACTED_PORT" ] && [ "$EXTRACTED_PORT" -gt 0 ] 2>/dev/null; then
            RAG_PORT=$EXTRACTED_PORT
        fi
    fi
    # Também tenta ler diretamente de rag.port se existir
    RAG_CONFIG_PORT=$(grep -A 2 '"rag"' api/data/config.json | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$RAG_CONFIG_PORT" ]; then
        RAG_PORT=$RAG_CONFIG_PORT
    fi
fi

# Verifica se a porta do RAG está em uso (uvicorn)
# Primeiro tenta encontrar processos uvicorn diretamente
UVICORN_PROCESS=$(ps aux | grep -E "(uvicorn|python.*uvicorn|python3.*uvicorn).*main:app" | grep -v grep | awk '{print $2}' | head -1)

# Verifica se a porta está em uso
PORT_IN_USE=false
if check_port $RAG_PORT; then
    PORT_IN_USE=true
    # Tenta obter PID da porta
    PORT_RAG_PID=$(get_port_pid $RAG_PORT)
fi

# Se encontrou processo uvicorn, usa ele (assume que está usando a porta)
if [ -n "$UVICORN_PROCESS" ]; then
    echo -e "${GREEN}Uvicorn já está rodando (PID: $UVICORN_PROCESS)${NC}"
    echo -e "${BLUE}Usando uvicorn existente...${NC}"
    UVICORN_PID=$UVICORN_PROCESS
    USE_EXISTING_UVICORN=true
elif [ "$PORT_IN_USE" = true ]; then
    # Porta está em uso mas não encontrou processo uvicorn
    echo -e "${YELLOW}Aviso: Porta ${RAG_PORT} já está em uso${NC}"
    
    if [ -n "$PORT_RAG_PID" ] && [ "$PORT_RAG_PID" != "-" ]; then
        echo -e "${YELLOW}Verificando processo na porta (PID: $PORT_RAG_PID)...${NC}"
        PROCESS_CMD=$(ps -p $PORT_RAG_PID -o cmd= 2>/dev/null)
        if echo "$PROCESS_CMD" | grep -qE "(uvicorn|main:app|rag-service|python.*${RAG_PORT})"; then
            echo -e "${GREEN}Uvicorn já está rodando (PID: $PORT_RAG_PID)${NC}"
            echo -e "${BLUE}Usando uvicorn existente...${NC}"
            UVICORN_PID=$PORT_RAG_PID
            USE_EXISTING_UVICORN=true
        else
            echo -e "${RED}Erro: Porta ${RAG_PORT} está em uso por outro processo${NC}"
            echo -e "${YELLOW}Comando do processo: $PROCESS_CMD${NC}"
            echo -e "${YELLOW}Execute: lsof -ti:${RAG_PORT} | xargs kill${NC}"
            exit 1
        fi
    else
        # Não conseguiu obter PID, mas porta está em uso
        # Tenta uma última vez encontrar uvicorn
        UVICORN_CHECK=$(check_uvicorn_running $RAG_PORT)
        if [ -n "$UVICORN_CHECK" ]; then
            echo -e "${GREEN}Uvicorn já está rodando (PID: $UVICORN_CHECK)${NC}"
            echo -e "${BLUE}Usando uvicorn existente...${NC}"
            UVICORN_PID=$UVICORN_CHECK
            USE_EXISTING_UVICORN=true
        else
            echo -e "${YELLOW}Não foi possível identificar o processo usando a porta ${RAG_PORT}${NC}"
            echo -e "${YELLOW}Mas a porta está em uso. Tentando iniciar mesmo assim...${NC}"
            echo -e "${YELLOW}(Se falhar, execute: lsof -ti:${RAG_PORT} | xargs kill)${NC}"
            # Continua para tentar iniciar (pode falhar, mas pelo menos tenta)
        fi
    fi
else
    # Verificação dupla antes de iniciar (pode ter mudado entre as verificações)
    PORT_RAG_PID=$(get_port_pid $RAG_PORT)
    if [ -n "$PORT_RAG_PID" ]; then
        echo -e "${YELLOW}Aviso: Porta ${RAG_PORT} ficou em uso durante a verificação${NC}"
        PROCESS_CMD=$(ps -p $PORT_RAG_PID -o cmd= 2>/dev/null)
        if echo "$PROCESS_CMD" | grep -qE "(uvicorn|main:app|rag-service|python.*${RAG_PORT})"; then
            echo -e "${GREEN}Uvicorn já está rodando (PID: $PORT_RAG_PID) na porta ${RAG_PORT}${NC}"
            echo -e "${BLUE}Usando uvicorn existente...${NC}"
            UVICORN_PID=$PORT_RAG_PID
            USE_EXISTING_UVICORN=true
        else
            echo -e "${RED}Erro: Porta ${RAG_PORT} está em uso por outro processo${NC}"
            echo -e "${YELLOW}Execute: lsof -ti:${RAG_PORT} | xargs kill${NC}"
            exit 1
        fi
    else
        # Verificação final antes de iniciar (pode ter mudado no último momento)
        sleep 0.5
        PORT_RAG_PID=$(get_port_pid $RAG_PORT)
        if [ -n "$PORT_RAG_PID" ]; then
            PROCESS_CMD=$(ps -p $PORT_RAG_PID -o cmd= 2>/dev/null)
            if echo "$PROCESS_CMD" | grep -qE "(uvicorn|main:app|rag-service|python.*${RAG_PORT})"; then
                echo -e "${GREEN}Uvicorn já está rodando (PID: $PORT_RAG_PID) na porta ${RAG_PORT}${NC}"
                echo -e "${BLUE}Usando uvicorn existente...${NC}"
                UVICORN_PID=$PORT_RAG_PID
                USE_EXISTING_UVICORN=true
            else
                echo -e "${RED}Erro: Porta ${RAG_PORT} está em uso por outro processo${NC}"
                echo -e "${YELLOW}Execute: lsof -ti:${RAG_PORT} | xargs kill${NC}"
                exit 1
            fi
        else
            # Inicia o uvicorn em background
            echo -e "${GREEN}Iniciando uvicorn na porta ${RAG_PORT}...${NC}"
            # Verifica se há ambiente virtual no rag-service
            UVICORN_STARTED=false
            if [ -f "rag-service/venv/bin/uvicorn" ]; then
                cd rag-service
                ./venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port $RAG_PORT > /dev/null 2>&1 &
                UVICORN_PID=$!
                cd ..
                UVICORN_STARTED=true
            elif command -v uvicorn &> /dev/null; then
                cd rag-service
                uvicorn main:app --reload --host 0.0.0.0 --port $RAG_PORT 2>&1 &
                UVICORN_PID=$!
                cd ..
                UVICORN_STARTED=true
            elif command -v python3 &> /dev/null; then
                cd rag-service
                python3 -m uvicorn main:app --reload --host 0.0.0.0 --port $RAG_PORT 2>&1 &
                UVICORN_PID=$!
                cd ..
                UVICORN_STARTED=true
            else
                echo -e "${RED}Erro: uvicorn não encontrado. Instale o ambiente virtual em rag-service/venv${NC}"
                exit 1
            fi
        
            if [ "$UVICORN_STARTED" = true ]; then
                USE_EXISTING_UVICORN=false
                
                # Verificação imediata (pode ter falhado imediatamente)
                sleep 1
                if ! kill -0 $UVICORN_PID 2>/dev/null; then
                    # Processo terminou imediatamente, verifica se a porta está em uso
                    PORT_RAG_PID=$(get_port_pid $RAG_PORT)
                    if [ -n "$PORT_RAG_PID" ]; then
                        PROCESS_CMD=$(ps -p $PORT_RAG_PID -o cmd= 2>/dev/null)
                        if echo "$PROCESS_CMD" | grep -qE "(uvicorn|main:app|rag-service|python.*${RAG_PORT})"; then
                            echo -e "${GREEN}Uvicorn já estava rodando (PID: $PORT_RAG_PID) na porta ${RAG_PORT}${NC}"
                            echo -e "${BLUE}Usando uvicorn existente...${NC}"
                            UVICORN_PID=$PORT_RAG_PID
                            USE_EXISTING_UVICORN=true
                        else
                            echo -e "${RED}Erro: Uvicorn não iniciou e porta ${RAG_PORT} está em uso por outro processo${NC}"
                            echo -e "${YELLOW}Execute: lsof -ti:${RAG_PORT} | xargs kill${NC}"
                            exit 1
                        fi
                    else
                        echo -e "${RED}Erro: Uvicorn não iniciou corretamente (processo terminou)${NC}"
                        exit 1
                    fi
                else
                    # Aguarda mais um pouco para o uvicorn iniciar completamente
                    sleep 2
                    
                    # Verifica novamente se o uvicorn está rodando
                    if ! kill -0 $UVICORN_PID 2>/dev/null; then
                        echo -e "${RED}Erro: Uvicorn não iniciou corretamente (processo terminou)${NC}"
                        exit 1
                    fi
                fi
                
                # Verifica se a porta do RAG está realmente em uso pelo processo
                # Aguarda um pouco mais para o uvicorn inicializar completamente
                echo -e "${BLUE}Aguardando uvicorn inicializar na porta ${RAG_PORT}...${NC}"
                PORT_ACTIVE=false
                for i in {1..10}; do
                    if check_port $RAG_PORT; then
                        PORT_ACTIVE=true
                        echo -e "${GREEN}Porta ${RAG_PORT} está ativa!${NC}"
                        break
                    fi
                    if [ $i -lt 10 ]; then
                        sleep 1
                    fi
                done
                
                if [ "$PORT_ACTIVE" = false ]; then
                    # Verifica se o processo ainda está rodando
                    if kill -0 $UVICORN_PID 2>/dev/null; then
                        echo -e "${YELLOW}Aviso: Uvicorn está rodando mas porta ${RAG_PORT} ainda não está ativa${NC}"
                        echo -e "${YELLOW}Isso pode ser normal - o uvicorn pode estar ainda inicializando${NC}"
                        echo -e "${YELLOW}O serviço deve ficar disponível em breve${NC}"
                        # Não mata o processo, deixa continuar
                    else
                        echo -e "${RED}Erro: Uvicorn não conseguiu iniciar corretamente${NC}"
                        exit 1
                    fi
                fi
            fi
        fi
    fi
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

# Verifica se a porta do frontend está em uso
if check_port $FRONTEND_PORT; then
    echo -e "${YELLOW}Aviso: Porta ${FRONTEND_PORT} já está em uso${NC}"
    echo -e "${YELLOW}Verificando se é o frontend do projeto...${NC}"
    
    # Tenta encontrar o processo Vite
    FRONTEND_PROCESS=$(ps aux | grep -E "vite|node.*frontend" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ -n "$FRONTEND_PROCESS" ]; then
        echo -e "${GREEN}Frontend já está rodando (PID: $FRONTEND_PROCESS)${NC}"
        echo -e "${BLUE}Usando frontend existente...${NC}"
        FRONTEND_PID=$FRONTEND_PROCESS
        USE_EXISTING_FRONTEND=true
    else
        echo -e "${RED}Erro: Porta ${FRONTEND_PORT} está em uso por outro processo${NC}"
        echo -e "${YELLOW}Execute: lsof -ti:${FRONTEND_PORT} | xargs kill${NC}"
        exit 1
    fi
else
    # Inicia o frontend (Vite)
    echo -e "${GREEN}Iniciando Frontend (Vite) na porta ${FRONTEND_PORT}...${NC}"
    cd frontend
    npm start &
    FRONTEND_PID=$!
    cd ..
    USE_EXISTING_FRONTEND=false
fi

echo -e "${BLUE}Servidores iniciados!${NC}"
echo -e "${GREEN}API (nodemon): http://localhost:3000${NC}"
echo -e "${GREEN}Uvicorn: http://localhost:${RAG_PORT}${NC}"
echo -e "${GREEN}Frontend (Vite): http://localhost:${FRONTEND_PORT}${NC}"
echo ""

# Determina quantos processos foram iniciados
NEW_PROCESSES=0
if [ "$USE_EXISTING_API" != true ]; then
    NEW_PROCESSES=$((NEW_PROCESSES + 1))
fi
if [ "$USE_EXISTING_UVICORN" != true ]; then
    NEW_PROCESSES=$((NEW_PROCESSES + 1))
fi
if [ "$USE_EXISTING_FRONTEND" != true ]; then
    NEW_PROCESSES=$((NEW_PROCESSES + 1))
fi

if [ $NEW_PROCESSES -eq 0 ]; then
    echo -e "${YELLOW}Aviso: Todos os servidores já estavam rodando. Nenhum será parado ao pressionar Ctrl+C${NC}"
    echo -e "${BLUE}Pressione Ctrl+C para sair${NC}"
    wait
elif [ $NEW_PROCESSES -eq 3 ]; then
    echo -e "${BLUE}Pressione Ctrl+C para parar todos os servidores${NC}"
    wait
else
    echo -e "${YELLOW}Aviso: Alguns servidores já estavam rodando${NC}"
    echo -e "${BLUE}Pressione Ctrl+C para parar os servidores iniciados${NC}"
    wait
fi

