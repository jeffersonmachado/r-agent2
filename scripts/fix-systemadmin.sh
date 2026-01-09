#!/bin/bash
# Script para garantir que o systemadmin existe no container

set -e

CONTAINER_NAME="r-agent2-api-prod"
REMOTE_HOST="${DEPLOY_HOST:-10.10.2.30}"
REMOTE_USER="${DEPLOY_USER:-root}"

echo "=== Script para garantir systemadmin no container ==="
echo ""

# Verifica se está rodando localmente ou remotamente
if [ -n "$REMOTE_HOST" ] && [ "$REMOTE_HOST" != "localhost" ] && [ "$REMOTE_HOST" != "127.0.0.1" ]; then
    echo "🔧 Modo remoto: $REMOTE_USER@$REMOTE_HOST"
    SSH_CMD="sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
    DOCKER_CMD="$SSH_CMD $REMOTE_USER@$REMOTE_HOST docker"
    EXEC_CMD="$SSH_CMD $REMOTE_USER@$REMOTE_HOST 'docker exec $CONTAINER_NAME'"
else
    echo "🔧 Modo local"
    DOCKER_CMD="docker"
    EXEC_CMD="docker exec $CONTAINER_NAME"
fi

echo ""
echo "=== Verificando container ==="
if $DOCKER_CMD ps | grep -q "$CONTAINER_NAME"; then
    echo "✅ Container $CONTAINER_NAME está rodando"
else
    echo "❌ Container $CONTAINER_NAME não está rodando"
    exit 1
fi

echo ""
echo "=== Verificando arquivo agents.json ==="
if eval "$EXEC_CMD ls /app/api/data/agents.json" > /dev/null 2>&1; then
    echo "✅ Arquivo agents.json existe"
    
    # Verifica se systemadmin existe
    SYSTEMADMIN_EXISTS=$(eval "$EXEC_CMD cat /app/api/data/agents.json" 2>/dev/null | grep -i '"username".*"systemadmin"' || echo "")
    if [ -n "$SYSTEMADMIN_EXISTS" ]; then
        echo "✅ systemadmin encontrado no arquivo"
        eval "$EXEC_CMD cat /app/api/data/agents.json" | grep -A 5 -B 5 '"username".*"systemadmin"' || true
    else
        echo "❌ systemadmin NÃO encontrado no arquivo"
        echo ""
        echo "=== Verificando logs de inicialização ==="
        eval "$DOCKER_CMD logs $CONTAINER_NAME" 2>&1 | grep -i "systemadmin\|Init\|Super Admin" | tail -10 || true
        echo ""
        echo "=== Tentando forçar criação do systemadmin ==="
        echo "Reiniciando o container para forçar inicialização..."
        eval "$DOCKER_CMD restart $CONTAINER_NAME"
        echo "Aguardando 15 segundos para inicialização..."
        sleep 15
        echo ""
        echo "=== Verificando novamente após restart ==="
        eval "$EXEC_CMD cat /app/api/data/agents.json" 2>/dev/null | grep -i '"username".*"systemadmin"' && echo "✅ systemadmin criado!" || echo "❌ systemadmin ainda não existe"
    fi
else
    echo "❌ Arquivo agents.json não existe"
    echo "O volume pode estar vazio. Reiniciando container para forçar inicialização..."
    eval "$DOCKER_CMD restart $CONTAINER_NAME"
    sleep 15
    echo ""
    echo "Verificando novamente..."
    if eval "$EXEC_CMD ls /app/api/data/agents.json" > /dev/null 2>&1; then
        echo "✅ Arquivo criado após restart"
    else
        echo "❌ Arquivo ainda não existe. Verifique os logs do container."
    fi
fi

echo ""
echo "=== Logs recentes de inicialização ==="
eval "$DOCKER_CMD logs $CONTAINER_NAME" 2>&1 | grep -i "systemadmin\|Init\|Super Admin\|Tenant.*system" | tail -20 || true

echo ""
echo "=== Fim da verificação ==="
