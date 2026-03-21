#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TOKEN="${TOKEN:-}"
TENANT_ID="${TENANT_ID:-}"
TICKET_ID="${TICKET_ID:-}"
CONVERSATION_ID="${CONVERSATION_ID:-}"

if [[ -z "${TOKEN}" || -z "${TENANT_ID}" ]]; then
  echo "Use TOKEN e TENANT_ID para autenticar as chamadas."
  echo "Exemplo:"
  echo "  BASE_URL=http://localhost:3001 TOKEN=... TENANT_ID=tenant TICKET_ID=t1 CONVERSATION_ID=c1 bash scripts/smoke-evidence.sh"
  exit 1
fi

auth_headers=(
  -H "Authorization: Bearer ${TOKEN}"
  -H "x-tenant-id: ${TENANT_ID}"
)

print_json() {
  if command -v jq >/dev/null 2>&1; then
    jq '{
      ok,
      identity,
      best,
      alternatives,
      reasoning,
      summary: {
        timeline_count: (.timeline | length? // 0),
        evidence_best_score: (.evidence.reasoning.score? // .reasoning.score? // 0),
        evidence_alternatives: (.alternatives | length? // 0),
        extracted: .extracted,
        created: .created,
        existing: .existing,
        processed: .processed
      }
    }'
  else
    cat
  fi
}

section() {
  echo
  echo "== $1 =="
}

build_context_json() {
  local context="{"
  if [[ -n "${TICKET_ID}" ]]; then
    context="${context}\"ticketId\":\"${TICKET_ID}\""
  fi
  if [[ -n "${CONVERSATION_ID}" ]]; then
    if [[ "${context}" != "{" ]]; then
      context="${context},"
    fi
    context="${context}\"conversationId\":\"${CONVERSATION_ID}\""
  fi
  context="${context}}"
  printf '%s' "${context}"
}

section "Health"
curl -sS "${BASE_URL}/health" | if command -v jq >/dev/null 2>&1; then jq .; else cat; fi
echo

section "Backfill dry-run"
curl -sS -X POST "${BASE_URL}/api/evidence/backfill" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"scope":"tenant","dryRun":true}' | print_json
echo

if [[ -n "${TICKET_ID}" ]]; then
  section "History by ticket"
  curl -sS -G "${BASE_URL}/api/evidence/entity/history" \
    "${auth_headers[@]}" \
    --data-urlencode "ticketId=${TICKET_ID}" \
    --data-urlencode "limit=5" | print_json
  echo
fi

if [[ -n "${CONVERSATION_ID}" ]]; then
  section "History by conversation"
  curl -sS -G "${BASE_URL}/api/evidence/entity/history" \
    "${auth_headers[@]}" \
    --data-urlencode "conversationId=${CONVERSATION_ID}" \
    --data-urlencode "limit=5" | print_json
  echo
fi

if [[ -n "${TICKET_ID}" || -n "${CONVERSATION_ID}" ]]; then
  context_json="$(build_context_json)"

  section "Contextual search"
  curl -sS -X POST "${BASE_URL}/api/evidence/search" \
    "${auth_headers[@]}" \
    -H "Content-Type: application/json" \
    -d "{
      \"context\": ${context_json},
      \"query\": \"cliente questiona aumento\",
      \"options\": {
        \"limit\": 5,
        \"includeWeak\": false
      }
    }" | print_json
  echo

  if [[ -n "${TICKET_ID}" ]]; then
    section "Filtered search"
    curl -sS -X POST "${BASE_URL}/api/evidence/search" \
      "${auth_headers[@]}" \
      -H "Content-Type: application/json" \
      -d "{
        \"context\": {
          \"ticketId\": \"${TICKET_ID}\"
        },
        \"filters\": {
          \"category\": [\"billing\", \"communication\"],
          \"type\": [\"price_notice\", \"policy_notice\"],
          \"theme\": [\"price_adjustment\", \"renewal\"]
        },
        \"query\": \"reajuste comunicado anteriormente\",
        \"options\": {
          \"limit\": 5
        }
      }" | print_json
    echo
  fi
fi

section "Done"
