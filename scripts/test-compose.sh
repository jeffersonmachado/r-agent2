#!/usr/bin/env bash
set -euo pipefail

##
## Script de smoke test do empacotamento Docker Compose da plataforma.
##
## Requisitos:
## - docker e docker compose instalados
## - acesso local à porta configurada em API_PORT/FRONTEND_PORT
##

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] Preparando arquivo .env (se não existir)..."
if [ ! -f .env ]; then
  if [ -f env.example ]; then
    cp env.example .env
    echo "  - .env criado a partir de env.example"
  else
    echo "Erro: env.example não encontrado; crie um .env manualmente."
    exit 1
  fi
else
  echo "  - .env já existe, mantendo configuração atual"
fi

export $(grep -v '^#' .env | xargs -d '\n' -r)

API_PORT="${API_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-8080}"

echo "[2/4] Fazendo build das imagens com docker compose..."
docker compose --env-file .env build

echo "[3/4] Subindo serviços em background..."
docker compose --env-file .env up -d

echo "[4/4] Verificando endpoints básicos..."

echo "  - Aguardando API em http://localhost:${API_PORT}/health"
for i in {1..20}; do
  if curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    echo "    OK: API respondeu em /health"
    break
  fi
  sleep 1
  if [ "$i" -eq 20 ]; then
    echo "    Falha: API não respondeu em /health após 20s"
    exit 1
  fi
done

echo "  - Verifique o frontend em http://localhost:${FRONTEND_PORT}"

echo
echo "Smoke test concluído com sucesso."
echo "Para limpar o ambiente, execute:"
echo "  docker compose --env-file .env down -v"


