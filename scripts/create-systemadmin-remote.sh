#!/bin/bash
# Script para criar systemadmin diretamente no container remoto

REMOTE_HOST="${1:-10.10.2.30}"
REMOTE_USER="${2:-root}"
CONTAINER="r-agent2-api-prod"

echo "=== Criando systemadmin no container remoto ==="
echo "Servidor: $REMOTE_USER@$REMOTE_HOST"
echo "Container: $CONTAINER"
echo ""

# Cria o script Node.js localmente primeiro
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << 'EOFNODE'
const { createAgent, listAgents } = require("./api/services/authService");
const { createTenant, getTenant } = require("./api/services/tenantService");

async function createSystemAdmin() {
  try {
    console.log("[Script] Verificando tenant system...");
    let tenant = getTenant("system");
    
    if (!tenant) {
      console.log("[Script] Criando tenant system...");
      const tenantResult = createTenant({
        id: "system",
        name: "Sistema",
        site: "https://sistema.com",
        ramo_atividade: "Sistema de Administração",
        objetivo: "Administração global do sistema",
        plan: "enterprise",
      });
      
      if (!tenantResult.success) {
        console.error("[Script] Erro ao criar tenant:", tenantResult.error);
        process.exit(1);
      }
      tenant = tenantResult.tenant;
      console.log("[Script] ✅ Tenant criado com sucesso");
    } else {
      console.log("[Script] ✅ Tenant já existe");
    }
    
    console.log("[Script] Verificando systemadmin...");
    const agents = listAgents("system");
    const exists = agents.some(a => a.username && a.username.toLowerCase() === "systemadmin");
    
    if (exists) {
      console.log("[Script] ✅ systemadmin já existe!");
      const admin = agents.find(a => a.username && a.username.toLowerCase() === "systemadmin");
      console.log("[Script] ID do systemadmin:", admin.id);
      process.exit(0);
    }
    
    console.log("[Script] Criando systemadmin...");
    const result = createAgent({
      tenantId: "system",
      username: "systemadmin",
      email: "systemadmin@exemplo.com",
      password: "Admin123!",
      role: "owner",
      name: "Administrador do Sistema",
    });
    
    if (result.success) {
      console.log("[Script] ✅ systemadmin criado com sucesso!");
      console.log("[Script] ID:", result.agent.id);
      console.log("[Script] Username: systemadmin");
      console.log("[Script] Password: Admin123!");
      process.exit(0);
    } else {
      console.error("[Script] ❌ Erro ao criar:", result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error("[Script] ❌ Erro:", error.message);
    console.error("[Script] Stack:", error.stack);
    process.exit(1);
  }
}

createSystemAdmin();
EOFNODE

# Copia o script para o servidor remoto primeiro, depois para o container
echo "Copiando script para o servidor remoto..."
sshpass -e scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  "$TEMP_SCRIPT" $REMOTE_USER@$REMOTE_HOST:/tmp/create-systemadmin.js

if [ $? -ne 0 ]; then
  echo "❌ Erro ao copiar script para o servidor remoto"
  rm -f "$TEMP_SCRIPT"
  exit 1
fi

# Copia do servidor para dentro do container
echo "Copiando script para dentro do container..."
sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  $REMOTE_USER@$REMOTE_HOST "docker cp /tmp/create-systemadmin.js $CONTAINER:/tmp/create-systemadmin.js"

if [ $? -ne 0 ]; then
  echo "❌ Erro ao copiar script para o container"
  sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    $REMOTE_USER@$REMOTE_HOST "rm -f /tmp/create-systemadmin.js" 2>/dev/null || true
  rm -f "$TEMP_SCRIPT"
  exit 1
fi

# Limpa arquivo temporário do servidor
sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  $REMOTE_USER@$REMOTE_HOST "rm -f /tmp/create-systemadmin.js" 2>/dev/null || true

# Executa o script no container
echo ""
echo "Executando script no container..."
sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER node /tmp/create-systemadmin.js"

EXIT_CODE=$?

# Limpa arquivo temporário do container
echo ""
echo "Limpando arquivo temporário do container..."
sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER rm -f /tmp/create-systemadmin.js" 2>/dev/null || true

# Limpa arquivo local
rm -f "$TEMP_SCRIPT"

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== Verificando se systemadmin foi criado ==="
  sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    $REMOTE_USER@$REMOTE_HOST "docker exec $CONTAINER cat /app/api/data/agents.json 2>/dev/null | grep -A 5 -B 2 'systemadmin' || echo '❌ systemadmin não encontrado no arquivo'"
else
  echo "⚠️  Script retornou código de erro: $EXIT_CODE"
  echo ""
  echo "Verificando logs do container (últimas 30 linhas)..."
  sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    $REMOTE_USER@$REMOTE_HOST "docker logs $CONTAINER --tail 30 2>&1 | grep -i 'error\|erro\|systemadmin\|init' || docker logs $CONTAINER --tail 30"
fi

echo ""
echo "=== Concluído ==="
