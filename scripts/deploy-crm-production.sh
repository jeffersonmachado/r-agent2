#!/bin/bash

# ============================================================================
# SCRIPT: Deploy CRM Production - Solução para API 404 e WebSocket
# ============================================================================
# Este script corrige os erros em produção e faz o deploy completo
# ============================================================================

set -e

echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║              🚀 DEPLOY CRM PRODUCTION - Iniciando                      ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_ROOT="/opt/results/ria/r-agent2"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
WEB_ROOT="/var/www/r-agent2"
LOG_FILE="/tmp/crm-deploy-$(date +%s).log"

# ============================================================================
# Função para logging
# ============================================================================
log() {
  echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
  echo -e "${RED}[$(date +'%H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
  echo -e "${YELLOW}[$(date +'%H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

# ============================================================================
# Validações Iniciais
# ============================================================================

log "📋 Validando ambiente..."

if [ ! -d "$PROJECT_ROOT" ]; then
  log_error "Diretório do projeto não encontrado: $PROJECT_ROOT"
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/.env.production" ]; then
  log_error "Arquivo .env.production não encontrado"
  exit 1
fi

log "✅ Validações OK"

# ============================================================================
# Step 1: Verificar se Node.js está instalado
# ============================================================================

log "🔍 Verificando Node.js..."
if ! command -v node &> /dev/null; then
  log_error "Node.js não está instalado"
  exit 1
fi

NODE_VERSION=$(node --version)
log "✅ Node.js $NODE_VERSION está instalado"

# ============================================================================
# Step 2: Instalar dependências do frontend
# ============================================================================

log "📦 Instalando dependências do frontend..."
cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  log "node_modules não existe, instalando..."
  npm install --production 2>&1 | tee -a "$LOG_FILE" | tail -5
else
  log "node_modules já existe, skipando instalação"
fi

log "✅ Dependências do frontend OK"

# ============================================================================
# Step 3: Build do Frontend
# ============================================================================

log "🏗️  Buildando frontend (Vite)..."
npm run build 2>&1 | tee -a "$LOG_FILE" | tail -10

if [ ! -d "dist" ]; then
  log_error "Build falhou - diretório dist não foi criado"
  exit 1
fi

log "✅ Build do frontend concluído"

# ============================================================================
# Step 4: Validar arquivos compilados
# ============================================================================

log "🔍 Validando arquivos compilados..."

if [ ! -f "dist/index.html" ]; then
  log_error "Arquivo index.html não encontrado em dist/"
  exit 1
fi

FILE_COUNT=$(find dist -type f | wc -l)
log "✅ $FILE_COUNT arquivos compilados"

# ============================================================================
# Step 5: Criar backup do web root
# ============================================================================

if [ -d "$WEB_ROOT" ] && [ -f "$WEB_ROOT/index.html" ]; then
  BACKUP_DIR="$WEB_ROOT.backup.$(date +%s)"
  log "💾 Criando backup: $BACKUP_DIR"
  sudo cp -r "$WEB_ROOT" "$BACKUP_DIR"
  log "✅ Backup criado"
else
  log "⚠️  Web root não existe ou está vazio, criando..."
  sudo mkdir -p "$WEB_ROOT"
fi

# ============================================================================
# Step 6: Deploy dos arquivos
# ============================================================================

log "📤 Deploying arquivos para $WEB_ROOT..."
rm -f "$PROJECT_ROOT/frontend/dist/.env*"  # Não copiar arquivos .env
sudo cp -r "$FRONTEND_DIR/dist/"* "$WEB_ROOT/" 2>&1 | tee -a "$LOG_FILE" | tail -5

log "✅ Arquivos deployed"

# ============================================================================
# Step 7: Configurar permissões
# ============================================================================

log "🔐 Configurando permissões..."
sudo chown -R www-data:www-data "$WEB_ROOT" || sudo chown -R nobody:nogroup "$WEB_ROOT"
sudo chmod -R 755 "$WEB_ROOT"
log "✅ Permissões configuradas"

# ============================================================================
# Step 8: Verificar nginx/apache
# ============================================================================

log "🌐 Verificando servidor web..."

if command -v nginx &> /dev/null; then
  log "Detectado: Nginx"
  log "Validando configuração..."
  sudo nginx -t 2>&1 | tee -a "$LOG_FILE"
  
  log "Reiniciando Nginx..."
  sudo systemctl restart nginx
  log "✅ Nginx reiniciado"
elif command -v apache2ctl &> /dev/null; then
  log "Detectado: Apache2"
  log "Validando configuração..."
  sudo apache2ctl configtest 2>&1 | tee -a "$LOG_FILE"
  
  log "Reiniciando Apache2..."
  sudo systemctl restart apache2
  log "✅ Apache2 reiniciado"
else
  log_warning "Servidor web (Nginx/Apache) não encontrado - faça restart manual"
fi

# ============================================================================
# Step 9: Verificar status
# ============================================================================

log "🔍 Verificando status do deployment..."

# Esperar um pouco para o servidor iniciar
sleep 2

# Testar se a página está respondendo
if command -v curl &> /dev/null; then
  log "Testando: https://www.results.com.br/r-agent2/"
  
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -k https://www.results.com.br/r-agent2/ || echo "000")
  
  if [ "$HTTP_CODE" = "200" ]; then
    log "✅ Frontend respondendo com HTTP $HTTP_CODE"
  else
    log_warning "Frontend retornou HTTP $HTTP_CODE"
  fi
fi

# ============================================================================
# Step 10: Sumário
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║                   ✅ DEPLOYMENT CONCLUÍDO COM SUCESSO                  ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"

echo ""
log "📊 Resumo:"
echo ""
echo "  Web Root:        $WEB_ROOT"
echo "  Arquivos:        $FILE_COUNT arquivos"
echo "  URL Frontend:    https://www.results.com.br/r-agent2/"
echo "  API Base:        https://www.results.com.br/r-agent2/api"
echo "  WebSocket:       wss://www.results.com.br/r-agent2/ws"
echo "  Log do Deploy:   $LOG_FILE"
echo ""

echo "🧪 TESTES RECOMENDADOS:"
echo ""
echo "  1. Acessar: https://www.results.com.br/r-agent2/crm"
echo "  2. Abrir DevTools (F12)"
echo "  3. Verificar que:"
echo "     - Não há erro 404 na API"
echo "     - WebSocket está CONNECTED"
echo "     - CRM está carregando dados"
echo ""

echo "🔄 MONITORAR LOGS:"
echo ""
if [ -d "/var/log/nginx" ]; then
  echo "  tail -f /var/log/nginx/access.log | grep r-agent2"
  echo "  tail -f /var/log/nginx/error.log"
elif [ -d "/var/log/apache2" ]; then
  echo "  tail -f /var/log/apache2/access.log | grep r-agent2"
  echo "  tail -f /var/log/apache2/error.log"
fi
echo ""

echo "📞 SE TIVER PROBLEMAS:"
echo ""
echo "  1. Verificar nginx/apache:"
echo "     sudo systemctl status nginx"
echo "     sudo systemctl status apache2"
echo ""
echo "  2. Verificar permissões:"
echo "     ls -la $WEB_ROOT"
echo ""
echo "  3. Verificar API backend:"
echo "     curl http://localhost:3000/api/health"
echo ""
echo "  4. Restaurar backup se necessário:"
if [ -d "$BACKUP_DIR" ]; then
  echo "     sudo rm -rf $WEB_ROOT"
  echo "     sudo cp -r $BACKUP_DIR $WEB_ROOT"
fi
echo ""
echo "════════════════════════════════════════════════════════════════════════╝"
echo ""

log "🎉 Deploy finalizado em $(date)"

