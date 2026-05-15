#!/bin/bash
# Script rápido para testar conexão SSH

: "${SSH_PASSWORD:?Erro: SSH_PASSWORD não definida}"
export SSHPASS="$SSH_PASSWORD"
REMOTE_HOST="${1:-10.10.2.30}"
REMOTE_USER="${2:-root}"

echo "=== Testando Conexão SSH ==="
echo "Host: $REMOTE_HOST"
echo "User: $REMOTE_USER"
echo ""

echo "1. Testando ping..."
if ping -c 2 -W 2 "$REMOTE_HOST" &>/dev/null; then
    echo "   ✅ Ping OK"
else
    echo "   ❌ Ping falhou"
    exit 1
fi

echo ""
echo "2. Testando SSH..."
if timeout 10 sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${REMOTE_USER}@${REMOTE_HOST} "echo 'SSH OK'" 2>&1 | grep -q "SSH OK"; then
    echo "   ✅ SSH OK"
else
    echo "   ❌ SSH falhou"
    echo "   Tentando novamente com mais detalhes..."
    timeout 10 sshpass -e ssh -v -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${REMOTE_USER}@${REMOTE_HOST} "echo 'SSH OK'" 2>&1 | tail -5
    exit 1
fi

echo ""
echo "3. Testando Docker no servidor..."
DOCKER_VERSION=$(timeout 10 sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${REMOTE_USER}@${REMOTE_HOST} "docker --version" 2>&1)
if echo "$DOCKER_VERSION" | grep -q "Docker version"; then
    echo "   ✅ Docker encontrado: $DOCKER_VERSION"
else
    echo "   ❌ Docker não encontrado"
    exit 1
fi

echo ""
echo "✅ Todos os testes passaram!"
echo "   O servidor está pronto para deploy."
