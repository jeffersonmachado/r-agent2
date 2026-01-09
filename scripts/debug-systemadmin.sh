#!/bin/bash
# Script para debugar a criação do systemadmin

REMOTE_HOST="${1:-10.10.2.30}"
REMOTE_USER="${2:-root}"

echo "=== Debug: Verificando systemadmin no servidor $REMOTE_HOST ==="
echo ""

# Comandos SSH
SSH_CMD="sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
CONTAINER="r-agent2-api-prod"

echo "1. Verificando se container está rodando..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker ps | grep $CONTAINER" || echo "❌ Container não está rodando"
echo ""

echo "2. Verificando arquivo agents.json..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER ls -la /app/api/data/agents.json 2>&1" || echo "Arquivo não existe"
echo ""

echo "3. Conteúdo do agents.json (primeiras 10 linhas)..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER cat /app/api/data/agents.json 2>&1 | head -20"
echo ""

echo "4. Procurando por 'systemadmin' no arquivo..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER cat /app/api/data/agents.json 2>&1 | grep -i systemadmin || echo '❌ systemadmin não encontrado'"
echo ""

echo "5. Verificando tenant 'system'..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER cat /app/api/data/tenants.json 2>&1 | grep -i '\"id\".*\"system\"' || echo '❌ Tenant system não encontrado'"
echo ""

echo "6. Logs completos de inicialização (últimas 50 linhas)..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker logs $CONTAINER 2>&1 | tail -50"
echo ""

echo "7. Procurando por erros nos logs..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker logs $CONTAINER 2>&1 | grep -i 'error\|erro\|fail\|exception' | tail -20"
echo ""

echo "8. Verificando se initializeSystemAdmin está sendo chamada..."
$SSH_CMD $REMOTE_USER@$REMOTE_HOST "docker logs $CONTAINER 2>&1 | grep -i 'initializeSystemAdmin\|Init.*systemadmin\|Super Admin' || echo '❌ Nenhuma mensagem de inicialização encontrada'"
echo ""

