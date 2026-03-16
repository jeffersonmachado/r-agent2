#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_TEST_PORT="${API_TEST_PORT:-13001}"
FRONTEND_TEST_PORT="${FRONTEND_TEST_PORT:-15173}"
RAG_TEST_PORT="${RAG_TEST_PORT:-18001}"

API_URL="${API_URL:-http://localhost:${API_TEST_PORT}}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:${FRONTEND_TEST_PORT}}"
RAG_URL="${RAG_URL:-http://localhost:${RAG_TEST_PORT}}"

check_json_field() {
  local name="$1"
  local url="$2"
  local expected_fragment="$3"

  echo "[stack-smoke] Verificando ${name}: ${url}"
  local body
  body="$(curl -fsS "$url")"
  if [[ "$body" != *"$expected_fragment"* ]]; then
    echo "[stack-smoke] ERRO ${name}: resposta não contém ${expected_fragment}"
    echo "$body"
    return 1
  fi
}

check_html() {
  local name="$1"
  local url="$2"

  echo "[stack-smoke] Verificando ${name}: ${url}"
  local body
  body="$(curl -fsS "$url")"
  if [[ "$body" != *"<!doctype html"* && "$body" != *"<html"* && "$body" != *"<HTML"* ]]; then
    echo "[stack-smoke] ERRO ${name}: resposta não parece HTML"
    echo "$body"
    return 1
  fi
}

echo "[stack-smoke] Aguardando stack ficar pronta..."
API_URL="$API_URL" FRONTEND_URL="$FRONTEND_URL" RAG_URL="$RAG_URL" bash ./scripts/wait-ready.sh

check_json_field "API live" "${API_URL}/health/live" '"status":"ok"'
check_json_field "API ready" "${API_URL}/health/ready" '"status":"ready"'
check_json_field "API version" "${API_URL}/version" '"name":"chatbot-engine-api"'
check_json_field "RAG health" "${RAG_URL}/health" '"status"'
check_html "Frontend root" "${FRONTEND_URL}/"

echo "[stack-smoke] OK"
