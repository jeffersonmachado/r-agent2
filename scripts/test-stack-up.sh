#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_IMAGE_PREFIX="${TEST_IMAGE_PREFIX:-r-agent2}"
TEST_IMAGE_TAG="${TEST_IMAGE_TAG:-test}"
TEST_API_BASE_IMAGE="${TEST_API_BASE_IMAGE:-${TEST_IMAGE_PREFIX}-api-base:${TEST_IMAGE_TAG}}"
export TEST_IMAGE_PREFIX TEST_IMAGE_TAG TEST_API_BASE_IMAGE

ensure_api_base_image() {
  local base_image="$TEST_API_BASE_IMAGE"
  local rebuild_base="${STACK_REBUILD_API_BASE:-0}"

  if [[ "$rebuild_base" == "1" ]]; then
    echo "[stack-up] STACK_REBUILD_API_BASE=1 -> rebuild da base ${base_image}"
  elif docker image inspect "$base_image" >/dev/null 2>&1; then
    echo "[stack-up] Base ${base_image} encontrada (reutilizando)"
    return 0
  else
    echo "[stack-up] Base ${base_image} não encontrada -> build inicial"
  fi

  docker build -f ./api/Dockerfile.base -t "$base_image" .
}

pull_test_images() {
  echo "[stack-up] STACK_PULL_IMAGES=1 -> tentando pull de imagens de teste..."
  docker compose -f docker-compose.test.yml pull --ignore-pull-failures api redis rag-service asterisk || true
}

echo "[stack-up] Subindo stack de teste (docker-compose.test.yml)..."
# AMI_SECRET fail-closed no compose de teste: gera um efêmero por subida quando
# o caller não fornece um (API e Asterisk leem o MESMO valor). Nunca logar.
if [[ -z "${AMI_SECRET:-}" ]]; then
  AMI_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  export AMI_SECRET
  echo "[stack-up] AMI_SECRET efêmero gerado para o stack de teste (valor não exibido)"
fi
# POSTGRES_PASSWORD fail-closed no compose de teste: efêmero por subida quando o
# caller não fornece um (o DB de teste é descartável; nunca logar o valor).
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  POSTGRES_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  export POSTGRES_PASSWORD
  echo "[stack-up] POSTGRES_PASSWORD efêmero gerado para o stack de teste (valor não exibido)"
fi
if [[ "${STACK_PULL_IMAGES:-}" == "1" ]]; then
  pull_test_images
fi
ensure_api_base_image

if [[ "${STACK_NO_BUILD:-}" == "1" ]]; then
  echo "[stack-up] STACK_NO_BUILD=1 → usando imagens locais (sem build)"
  docker compose -f docker-compose.test.yml up -d --no-build
else
  docker compose -f docker-compose.test.yml up -d --build
fi

echo "[stack-up] OK"
