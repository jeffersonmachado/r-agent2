#!/usr/bin/env bash
set -euo pipefail

IFS=$'\n\t'

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOTSTRAP_API_PORT="${SYSTEM_BOOTSTRAP_API_PORT:-13001}"
BOOTSTRAP_FRONTEND_PORT="${SYSTEM_BOOTSTRAP_FRONTEND_PORT:-14173}"
CHECK_ONLY=false
SKIP_SERVICE_PROBES=false

# ── PORTAS LIVRES (medido 2026-10-21, missão CI DEFINITIVO) ──────────────────────────────────
# Os defaults 13001/14173 eram FIXOS e o preview sobe com `--strictPort`. Resultado real: um
# preview órfão de uma execução anterior (ou de outro checkout na mesma máquina/runner) fazia o
# bootstrap INTEIRO reprovar com "Port 14173 is already in use" — o ambiente de validação só
# funcionava na primeira execução do computador, que é exatamente o que esta missão elimina.
# Agora: porta explícita (SYSTEM_BOOTSTRAP_*_PORT) é honrada e falha com mensagem clara se
# estiver ocupada; porta default ocupada é substituída por uma porta efêmera livre, registrada
# no log. `--strictPort` continua garantindo que a porta escolhida é a NOSSA.
porta_ocupada() {
        node -e "const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(0));s.once('listening',()=>s.close(()=>process.exit(1)));s.listen(Number(process.argv[1]),'127.0.0.1');" "$1"
}

porta_livre() {
        node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))})"
}

escolher_porta() {
        local rotulo="$1"
        local explicita="$2"
        local padrao="$3"
        if ! porta_ocupada "$padrao"; then printf '%s' "$padrao"; return 0; fi
        if [[ -n "$explicita" ]]; then
                echo -e "${RED}  x porta ${padrao} (${rotulo}) já está em uso e foi fixada explicitamente — libere a porta ou defina ${rotulo}" >&2
                return 1
        fi
        local alternativa
        alternativa="$(porta_livre)"
        echo -e "${YELLOW}  ! porta ${padrao} (${rotulo}) estava em uso; usando ${alternativa} (efêmera livre)${NC}" >&2
        printf '%s' "$alternativa"
}

BOOTSTRAP_API_PORT="$(escolher_porta SYSTEM_BOOTSTRAP_API_PORT "${SYSTEM_BOOTSTRAP_API_PORT:-}" "$BOOTSTRAP_API_PORT")" || exit 1
BOOTSTRAP_FRONTEND_PORT="$(escolher_porta SYSTEM_BOOTSTRAP_FRONTEND_PORT "${SYSTEM_BOOTSTRAP_FRONTEND_PORT:-}" "$BOOTSTRAP_FRONTEND_PORT")" || exit 1
API_URL="${SYSTEM_BOOTSTRAP_API_URL:-http://127.0.0.1:${BOOTSTRAP_API_PORT}}"
FRONTEND_URL="${SYSTEM_BOOTSTRAP_FRONTEND_URL:-http://127.0.0.1:${BOOTSTRAP_FRONTEND_PORT}}"

step() { echo -e "${BLUE}[bootstrap:official] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ! $*${NC}"; }
fail() { echo -e "${RED}  x $*${NC}" >&2; exit 1; }

version_ge() {
	local a="$1"
	local b="$2"
	local a1 a2 a3 b1 b2 b3
	IFS='.' read -r a1 a2 a3 <<< "$a"
	IFS='.' read -r b1 b2 b3 <<< "$b"
	a2="${a2:-0}"; a3="${a3:-0}"; b2="${b2:-0}"; b3="${b3:-0}"
	if (( a1 > b1 )); then return 0; fi
	if (( a1 < b1 )); then return 1; fi
	if (( a2 > b2 )); then return 0; fi
	if (( a2 < b2 )); then return 1; fi
	if (( a3 >= b3 )); then return 0; fi
	return 1
}

wait_http() {
	local url="$1"
	local name="$2"
	local timeout_secs="${3:-60}"
        local log_file="${4:-}"
        local started_at
        started_at="$(date +%s)"
        while true; do
                if curl -fsS "$url" >/dev/null 2>&1; then
                        ok "$name respondeu em $url"
                        return 0
                fi
                if (( $(date +%s) - started_at >= timeout_secs )); then
                        # DIAGNÓSTICO OBRIGATÓRIO: sem a cauda do log, a falha obriga a
                        # reexecutar para descobrir o motivo (medido: preview reprovava por
                        # porta ocupada e a mensagem só dizia "não respondeu").
                        if [[ -n "$log_file" && -f "$log_file" ]]; then
                                echo -e "${RED}── últimas linhas de ${log_file} ──${NC}" >&2
                                tail -n 15 "$log_file" >&2 || true
                                echo -e "${RED}── fim de ${log_file} ──${NC}" >&2
                        fi
                        fail "$name não respondeu em $url dentro de ${timeout_secs}s"
                fi
                sleep 1
        done
}

probe_json_status() {
	local url="$1"
	local expression="$2"
	local name="$3"
	local result
	if ! result="$(curl -sS "$url")"; then
		fail "$name indisponível em $url"
	fi
	node -e "const payload=JSON.parse(process.argv[1]); const ok=(${expression}); if(!ok){process.exit(1);}" "$result" || fail "$name retornou status inválido"
	ok "$name validado"
}

for arg in "$@"; do
	case "$arg" in
		--check) CHECK_ONLY=true ;;
		--skip-service-probes) SKIP_SERVICE_PROBES=true ;;
		-h|--help)
			echo 'Uso: ./scripts/bootstrap/official.sh [--check] [--skip-service-probes]'
			exit 0 ;;
		*) fail "Opção desconhecida: $arg" ;;
	esac
done

step 'Validando toolchain oficial'
command -v node >/dev/null 2>&1 || fail 'node não encontrado'
command -v npm >/dev/null 2>&1 || fail 'npm não encontrado'
command -v curl >/dev/null 2>&1 || fail 'curl não encontrado'

NODE_VER="$(node --version | tr -d 'v')"
NPM_VER="$(npm --version)"
NODE_MAJOR="${NODE_VER%%.*}"

if version_ge "$NODE_VER" '22.12.0'; then
	ok "Node.js $NODE_VER (preferencial)"
elif version_ge "$NODE_VER" '20.19.0' && (( NODE_MAJOR < 22 )); then
	warn "Node.js $NODE_VER suportado, mas 22.x é preferencial para bootstrap oficial"
else
	fail "Node.js $NODE_VER fora do contrato oficial (20.19+ ou 22.12+)"
fi

if [[ "${NPM_VER%%.*}" -lt 10 ]]; then
	fail "npm $NPM_VER fora do contrato oficial (>=10)"
fi
ok "npm $NPM_VER"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
	[[ -f "$ROOT_DIR/env.example" ]] || fail '.env ausente e env.example inexistente'
	cp "$ROOT_DIR/env.example" "$ROOT_DIR/.env"
	warn '.env criado a partir de env.example para bootstrap determinístico'
else
	ok '.env presente'
fi

if [[ ! -f "$ROOT_DIR/api/data/config.json" ]] && [[ -f "$ROOT_DIR/api/data/config.example.json" ]]; then
	cp "$ROOT_DIR/api/data/config.example.json" "$ROOT_DIR/api/data/config.json"
	warn 'api/data/config.json criado a partir do exemplo oficial'
fi

node "$ROOT_DIR/scripts/bootstrap/ensure-local-secrets.js" "$ROOT_DIR" >/dev/null
ok 'ENCRYPTION_KEY, RAG_INTERNAL_TOKEN e AMI_SECRET locais validados (valores não exibidos)'

if [[ "$CHECK_ONLY" == true ]]; then
	ok 'Pré-checagens concluídas'
	exit 0
fi

step 'Instalando dependências limpas do backend'
cd "$ROOT_DIR"
npm ci --no-audit --no-fund
ok 'Dependências do backend instaladas'

step 'Instalando dependências limpas do frontend'
if [[ -d "$ROOT_DIR/frontend/node_modules" ]]; then
	if find "$ROOT_DIR/frontend/node_modules" ! -writable -print -quit | grep -q .; then
		stale_dir="/tmp/r-agent2-frontend-node_modules.stale.$(date +%s)"
		warn "frontend/node_modules contém arquivos sem permissão de escrita; isolando em $stale_dir"
		mv "$ROOT_DIR/frontend/node_modules" "$stale_dir"
	fi
fi
for stale_dir in "$ROOT_DIR"/frontend/node_modules.stale.*; do
	if [[ -e "$stale_dir" ]]; then
		target_dir="/tmp/$(basename "$stale_dir")"
		warn "movendo diretório stale antigo para fora do frontend: $target_dir"
		mv "$stale_dir" "$target_dir"
	fi
done
npm run frontend:install
ok 'Dependências do frontend instaladas'

step 'Aplicando migrações do banco'
npm run db:migrate
ok 'Migrações concluídas'

step 'Validando invariantes do projeto'
node scripts/validate-invariants.js
ok 'Invariantes validados'

step 'Gerando build do frontend para smoke de bootstrap'
npm run frontend:build
ok 'Frontend buildado'

if [[ "$SKIP_SERVICE_PROBES" == true ]]; then
	warn 'Service probes desabilitados explicitamente (--skip-service-probes)'
	exit 0
fi

API_LOG="/tmp/r-agent2-bootstrap-api.log"
FRONTEND_LOG="/tmp/r-agent2-bootstrap-frontend.log"
API_PID=''
FRONTEND_PID=''

cleanup() {
	if [[ -n "$FRONTEND_PID" ]]; then kill "$FRONTEND_PID" >/dev/null 2>&1 || true; fi
	if [[ -n "$API_PID" ]]; then kill "$API_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

step 'Subindo backend para validação determinística'
API_PORT="$BOOTSTRAP_API_PORT" node api/server.js >"$API_LOG" 2>&1 &
API_PID=$!
wait_http "$API_URL/health" 'API' 60 "$API_LOG"
probe_json_status "$API_URL/health/ready" "payload && String(payload.status||'').toLowerCase()==='ready'" 'Health ready'
probe_json_status "$API_URL/health/selftest" "payload && payload.checks && typeof payload.checks === 'object'" 'Selftest'

step 'Subindo frontend preview para validação determinística'
(cd frontend && npm run preview -- --host 127.0.0.1 --port "$BOOTSTRAP_FRONTEND_PORT" --strictPort) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
wait_http "$FRONTEND_URL/" 'Frontend preview' 60 "$FRONTEND_LOG"

step 'Validando serviços essenciais via selftest'
probe_json_status "$API_URL/health/selftest" "payload && payload.checks && payload.checks.db && String(payload.checks.db.status||'').toLowerCase()!=='unhealthy'" 'Banco'
probe_json_status "$API_URL/health/selftest" "payload && payload.checks && payload.checks.redis && ['healthy','degraded'].includes(String(payload.checks.redis.status||'').toLowerCase())" 'Redis'
warn 'Validacao de RAG no bootstrap oficial e informativa e nao bloqueante'

ok 'Bootstrap oficial concluído com ambiente validado de forma explícita'
