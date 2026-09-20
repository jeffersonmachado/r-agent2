#!/usr/bin/env bash
#
# run-mcp-research-docker-e2e.sh — ciclo completo do E2E do MCP research:
# build -> up -d -> wait healthy -> gate MCP_RESEARCH_DOCKER_E2E.
#
# IDEMPOTENTE: se a stack já estava viva antes (container mcp-research-e2e
# existente), ela é REUSADA e NÃO é derrubada ao final. Se este script subiu a
# stack, ela também permanece de pé — é o ambiente de evidência do gate; o
# teardown é decisão operacional (docker compose -f ... down), nunca do gate.
#
# Uso:
#   bash scripts/governance/run-mcp-research-docker-e2e.sh [--with-restart]
#   npm run validate:mcp-research-docker-e2e:full
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

COMPOSE_FILE="docker-compose.mcp-research-e2e.yml"
CONTAINER="${MCP_RESEARCH_E2E_CONTAINER:-mcp-research-e2e}"
HEALTH_TIMEOUT_S="${MCP_E2E_HEALTH_TIMEOUT_S:-150}"

step() { printf '\033[0;34m[mcp-e2e-full] %s\033[0m\n' "$1"; }
bad()  { printf '\033[0;31m[mcp-e2e-full] ✗ %s\033[0m\n' "$1" >&2; }

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  bad "docker indisponível — o gate registrará REQUIRES_DOCKER_RUNTIME"
  node scripts/governance/validate-mcp-research-docker-e2e.js "$@"
  exit $?
fi

PREEXISTING=0
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  PREEXISTING=1
  step "stack viva detectada ($CONTAINER) — reusando; nada será derrubado"
fi

step "build (docker compose -f $COMPOSE_FILE build)"
docker compose -f "$COMPOSE_FILE" build || { bad "build falhou"; exit 1; }

step "up -d"
docker compose -f "$COMPOSE_FILE" up -d || { bad "up falhou"; exit 1; }

step "aguardando healthy (teto ${HEALTH_TIMEOUT_S}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
while :; do
  status="$(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null || echo missing)"
  health="$(docker inspect "$CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)"
  if [ "$status" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "none" ]; }; then
    step "container running/$health"
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    bad "timeout aguardando healthy (status=$status health=$health)"
    exit 1
  fi
  sleep 3
done

step "gate MCP_RESEARCH_DOCKER_E2E"
node scripts/governance/validate-mcp-research-docker-e2e.js "$@"
rc=$?

if [ "$PREEXISTING" = "1" ]; then
  step "stack pré-existente preservada (sem teardown)"
else
  step "stack deixada de pé como ambiente de evidência (teardown manual: docker compose -f $COMPOSE_FILE down)"
fi

exit $rc
