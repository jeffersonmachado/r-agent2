#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_IMAGE_PREFIX="${TEST_IMAGE_PREFIX:-r-agent2}"
TEST_IMAGE_TAG="${TEST_IMAGE_TAG:-test}"
TEST_API_BASE_IMAGE="${TEST_API_BASE_IMAGE:-${TEST_IMAGE_PREFIX}-api-base:${TEST_IMAGE_TAG}}"
export TEST_IMAGE_PREFIX TEST_IMAGE_TAG TEST_API_BASE_IMAGE

MODE="${1:-build}"

# docker-compose.test.yml exige AMI_SECRET e POSTGRES_PASSWORD (fail-closed) já
# para RESOLVER a config (build/pull/push). Valores placeholder bastam: estas
# operações não sobem container. Nunca logar.
export AMI_SECRET="${AMI_SECRET:-prewarm-config-resolution-only}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-prewarm-config-resolution-only}"

usage() {
  cat <<'USAGE'
Uso: scripts/prewarm-test-images.sh [build|pull|push]

Variáveis de ambiente:
  TEST_IMAGE_PREFIX   Prefixo/repositório das imagens (default: r-agent2)
  TEST_IMAGE_TAG      Tag das imagens de teste (default: test)
  TEST_API_BASE_IMAGE Nome completo da imagem base da API
                      (default: ${TEST_IMAGE_PREFIX}-api-base:${TEST_IMAGE_TAG})

Exemplos:
  scripts/prewarm-test-images.sh build
  TEST_IMAGE_PREFIX=ghcr.io/acme/r-agent2 TEST_IMAGE_TAG=ci-123 scripts/prewarm-test-images.sh build
  TEST_IMAGE_PREFIX=ghcr.io/acme/r-agent2 TEST_IMAGE_TAG=ci-123 scripts/prewarm-test-images.sh push
  TEST_IMAGE_PREFIX=ghcr.io/acme/r-agent2 TEST_IMAGE_TAG=ci-123 STACK_NO_BUILD=1 STACK_PULL_IMAGES=1 bash scripts/test-stack-up.sh
USAGE
}

build_images() {
  echo "[prewarm] build base image: $TEST_API_BASE_IMAGE"
  docker build -f ./api/Dockerfile.base -t "$TEST_API_BASE_IMAGE" .

  echo "[prewarm] build compose test images"
  docker compose -f docker-compose.test.yml build api redis rag-service asterisk

  echo "[prewarm] done (build)"
}

pull_images() {
  echo "[prewarm] pull compose test images"
  docker compose -f docker-compose.test.yml pull --ignore-pull-failures api redis rag-service asterisk

  echo "[prewarm] pull base image: $TEST_API_BASE_IMAGE"
  docker pull "$TEST_API_BASE_IMAGE" || true

  echo "[prewarm] done (pull)"
}

push_images() {
  echo "[prewarm] push base image: $TEST_API_BASE_IMAGE"
  docker push "$TEST_API_BASE_IMAGE"

  echo "[prewarm] push compose test images"
  docker compose -f docker-compose.test.yml push api redis rag-service asterisk

  echo "[prewarm] done (push)"
}

case "$MODE" in
  build)
    build_images
    ;;
  pull)
    pull_images
    ;;
  push)
    push_images
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "[prewarm] modo inválido: $MODE" >&2
    usage
    exit 2
    ;;
esac
