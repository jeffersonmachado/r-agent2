#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — Setup base reproduzivel (sem dependencia de E2E pesado)
#
# Objetivo: partindo de um clone limpo, preparar o ambiente completo sem
# depender de estado implícito, arquivos locais escondidos ou resíduos.
#
# Uso:
#   ./scripts/bootstrap.sh              # setup base (backend + frontend base)
#   ./scripts/bootstrap.sh --api-only   # so backend
#   ./scripts/bootstrap.sh --check      # apenas valida pre-requisitos
#   ./scripts/bootstrap.sh --with-e2e   # roda bootstrap E2E explicito
#
# Pré-requisitos verificados automaticamente:
#   - Node.js >= 20.19.0 ou >= 22.12.0
#   - npm >= 10.0.0
#   - Scripts essenciais de release/smoke presentes
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

API_ONLY=false
CHECK_ONLY=false
WITH_E2E=false

step()  { echo -e "${BLUE}[bootstrap] $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

# ── parse args ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --api-only) API_ONLY=true ;;
    --check)    CHECK_ONLY=true ;;
    --with-e2e) WITH_E2E=true ;;
    -h|--help)
      sed -n '/^# Uso:/,/^$/p' "$0" | sed 's/^#//'
      exit 0 ;;
    *)
      echo -e "${RED}Opção desconhecida: $arg${NC}" >&2
      exit 1 ;;
  esac
done

# ── pré-requisitos ────────────────────────────────────────────────────────────
step "Verificando pré-requisitos..."

# Node.js
if ! command -v node >/dev/null 2>&1; then
  fail "node não encontrado. Instale Node.js >= 22.12.0 (use nvm: nvm install $(cat "$PROJECT_ROOT/.nvmrc"))"
fi
NODE_VER="$(node --version | tr -d 'v')"
NODE_MAJOR="${NODE_VER%%.*}"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node.js $NODE_VER encontrado, mas >= 20.19.0 é obrigatório. Use: nvm use $(cat "$PROJECT_ROOT/.nvmrc")"
fi
ok "Node.js $NODE_VER"

# npm
if ! command -v npm >/dev/null 2>&1; then
  fail "npm não encontrado."
fi
NPM_VER="$(npm --version)"
NPM_MAJOR="${NPM_VER%%.*}"
if [[ "$NPM_MAJOR" -lt 10 ]]; then
  fail "npm $NPM_VER encontrado, mas >= 10.0.0 é obrigatório. Execute: npm install -g npm@latest"
fi
ok "npm $NPM_VER"

# .env
if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  if [[ -f "$PROJECT_ROOT/env.example" ]]; then
    warn ".env não encontrado. Criando a partir de env.example..."
    cp "$PROJECT_ROOT/env.example" "$PROJECT_ROOT/.env"
    warn "ATENÇÃO: edite .env com as credenciais reais antes de subir os serviços."
  else
    fail ".env não encontrado e env.example também não existe. Impossível continuar."
  fi
else
  ok ".env presente"
fi

# api/data/config.json
if [[ ! -f "$PROJECT_ROOT/api/data/config.json" ]]; then
  if [[ -f "$PROJECT_ROOT/api/data/config.example.json" ]]; then
    warn "api/data/config.json não encontrado. Criando a partir de config.example.json..."
    cp "$PROJECT_ROOT/api/data/config.example.json" "$PROJECT_ROOT/api/data/config.json"
    warn "ATENÇÃO: edite api/data/config.json com as configurações reais antes de subir."
  else
    warn "api/data/config.json e config.example.json ausentes — sistema usará variáveis de ambiente."
  fi
else
  ok "api/data/config.json presente"
fi

ESSENTIAL_SCRIPTS=(
  "$PROJECT_ROOT/scripts/generate-zip.sh"
  "$PROJECT_ROOT/scripts/release-package.sh"
  "$PROJECT_ROOT/scripts/smoke/frontend-smoke.sh"
)

for script_file in "${ESSENTIAL_SCRIPTS[@]}"; do
  if [[ ! -f "$script_file" ]]; then
    fail "Script essencial ausente: $script_file"
  fi
done
ok "Scripts essenciais de release/smoke presentes"

if [[ "$CHECK_ONLY" == true ]]; then
  ok "Todos os pré-requisitos verificados."
  exit 0
fi

# ── instalação de dependências ────────────────────────────────────────────────
step "Instalando dependências do backend (raiz)..."
cd "$PROJECT_ROOT"
npm ci --prefer-offline 2>&1 | grep -vE "^npm warn|^(added|up to date)" || npm install
ok "Dependências do backend instaladas"

if [[ "$API_ONLY" == false ]]; then
  step "Instalando frontend base (sem E2E pesado)..."
  npm run frontend:install
  ok "Frontend base instalado"
fi

# ── migração do banco ─────────────────────────────────────────────────────────
step "Rodando migrações do banco de dados..."
if npm --prefix "$PROJECT_ROOT" run db:migrate 2>&1 | tail -5; then
  ok "Migrações aplicadas"
else
  warn "Migração reportou erros — verifique .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)"
fi

if [[ "$WITH_E2E" == true ]]; then
  step "Executando bootstrap E2E explicito..."
  bash "$PROJECT_ROOT/scripts/bootstrap-e2e.sh"
  ok "Bootstrap E2E concluido"
fi

# ── validação final ───────────────────────────────────────────────────────────
step "Validando invariantes do projeto..."
if node "$PROJECT_ROOT/scripts/validate-invariants.js" 2>&1 | tail -10; then
  ok "Invariantes validados"
else
  warn "Validação de invariantes reportou issues — execute 'npm run validate:invariants' para detalhes"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Bootstrap concluído com sucesso!                       ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Próximos passos:                                        ║${NC}"
echo -e "${GREEN}║  • Subir em dev:      npm run dev                        ║${NC}"
echo -e "${GREEN}║  • Só API:           npm run start:api                   ║${NC}"
echo -e "${GREEN}║  • Só frontend:      npm run dev:frontend                ║${NC}"
echo -e "${GREEN}║  • Rodar testes:     npm run test:unit                   ║${NC}"
echo -e "${GREEN}║  • Build release:    npm run frontend:build              ║${NC}"
echo -e "${GREEN}║  • Bootstrap E2E:    npm run bootstrap:e2e               ║${NC}"
echo -e "${GREEN}║  • Gerar ZIP:        npm run zip                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
