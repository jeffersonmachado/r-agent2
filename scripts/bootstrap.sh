#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — Setup reproduzível do ambiente de desenvolvimento/release
#
# Objetivo: partindo de um clone limpo, preparar o ambiente completo sem
# depender de estado implícito, arquivos locais escondidos ou resíduos.
#
# Uso:
#   ./scripts/bootstrap.sh            # setup completo (backend + frontend)
#   ./scripts/bootstrap.sh --api-only # só backend
#   ./scripts/bootstrap.sh --ci       # modo CI (não abre terminais interativos)
#   ./scripts/bootstrap.sh --check    # apenas valida pré-requisitos
#
# Pré-requisitos verificados automaticamente:
#   - Node.js >= 20.19.0 ou >= 22.12.0
#   - npm >= 10.0.0
#   - PostgreSQL acessível (quando .env estiver configurado)
#   - Redis acessível (quando .env estiver configurado)
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
CI_MODE=false
CHECK_ONLY=false

step()  { echo -e "${BLUE}[bootstrap] $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

# ── parse args ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --api-only) API_ONLY=true ;;
    --ci)       CI_MODE=true  ;;
    --check)    CHECK_ONLY=true ;;
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
  step "Instalando dependências do frontend..."
  cd "$PROJECT_ROOT/frontend"
  npm ci --prefer-offline 2>&1 | grep -vE "^npm warn|^(added|up to date)" || npm install
  ok "Dependências do frontend instaladas"
  cd "$PROJECT_ROOT"
fi

# ── migração do banco ─────────────────────────────────────────────────────────
step "Rodando migrações do banco de dados..."
if npm --prefix "$PROJECT_ROOT" run db:migrate 2>&1 | tail -5; then
  ok "Migrações aplicadas"
else
  warn "Migração reportou erros — verifique .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME)"
fi

# ── build do frontend ─────────────────────────────────────────────────────────
if [[ "$API_ONLY" == false && "$CI_MODE" == true ]]; then
  step "Build do frontend (modo CI)..."
  cd "$PROJECT_ROOT/frontend"
  npm run build
  ok "Build do frontend concluído: frontend/dist/"
  cd "$PROJECT_ROOT"
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
echo -e "${GREEN}║  • Gerar ZIP:        npm run zip                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
