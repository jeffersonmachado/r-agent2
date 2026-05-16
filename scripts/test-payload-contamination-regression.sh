#!/usr/bin/env bash
# Regression test: forbidden files inside the payload must fail release gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/release-payload-blocklist.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

ok() { echo -e "${GREEN}  ✓ $*${NC}"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}  ✗ $*${NC}"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
step() { echo -e "${BLUE}[payload-regression] $*${NC}"; }

make_payload_with_entry() {
  local entry="$1"
  local out_zip="$2"
  local tmp
  tmp="$(mktemp -d -t r-agent2-payload-regression-XXXXXX)"
  mkdir -p "$tmp/r-agent2/$(dirname "$entry")"
  printf 'local-secret-test\n' > "$tmp/r-agent2/$entry"
  (cd "$tmp" && zip -qr "$out_zip" r-agent2)
  rm -rf "$tmp"
}

make_payload_with_entries() {
  local out_zip="$1"
  shift
  local entry
  local tmp
  tmp="$(mktemp -d -t r-agent2-payload-regression-XXXXXX)"
  for entry in "$@"; do
    mkdir -p "$tmp/r-agent2/$(dirname "$entry")"
    printf 'release-policy-test\n' > "$tmp/r-agent2/$entry"
  done
  (cd "$tmp" && zip -qr "$out_zip" r-agent2)
  rm -rf "$tmp"
}

expect_blocked() {
  local entry="$1"
  local tmp_zip
  tmp_zip="$(mktemp -t r-agent2-contaminated-payload.XXXXXX.zip)"
  rm -f "$tmp_zip"
  make_payload_with_entry "$entry" "$tmp_zip"
  if release_payload_validate_zip "$tmp_zip" "$entry" >/tmp/r-agent2-payload-regression.log 2>&1; then
    fail "contaminação aceita indevidamente: $entry"
  else
    ok "contaminação bloqueada: $entry"
  fi
  rm -f "$tmp_zip"
}

expect_allowed_set() {
  local label="$1"
  shift
  local tmp_zip
  tmp_zip="$(mktemp -t r-agent2-allowed-payload.XXXXXX.zip)"
  rm -f "$tmp_zip"
  make_payload_with_entries "$tmp_zip" "$@"
  if release_payload_validate_zip "$tmp_zip" "$label" >/tmp/r-agent2-payload-regression.log 2>&1; then
    ok "conteúdo permitido aceito: $label"
  else
    fail "conteúdo permitido bloqueado indevidamente: $label"
    sed 's/^/    /' /tmp/r-agent2-payload-regression.log || true
  fi
  rm -f "$tmp_zip"
}

step "Validando blacklist central contra payloads contaminados"
expect_blocked "core/rpa/config/rpa-token.json"
expect_blocked "tests/rpa/config/rpa-token.json"
expect_blocked ".claude/settings.local.json"
expect_blocked ".claude/settings.local.json.bkp"
expect_blocked ".codex/session.json"
expect_blocked ".tmp-validate-replays.js"
expect_blocked "modal-screenshot.png"
expect_blocked "qa/bpmn-smoke-artifacts/bpmn-smoke.png"
expect_blocked "debug/capture.png"
expect_blocked "artifacts/capture.jpg"
expect_blocked "cache/capture.webp"
expect_blocked "node_modules/pkg/index.js"
expect_blocked "tmp/cache.txt"
expect_blocked "playwright-report/index.html"
expect_blocked "test-results/result.json"
expect_blocked "tests/rpa/screenshots/leak.png"
expect_blocked "tests/rpa/videos/leak.webm"
expect_blocked "tests/rpa/traces/leak.trace.zip"

expect_allowed_set "approved image assets and structured screenshot evidence" \
  "frontend/public/images/home_results_29.png" \
  "frontend/public/icons/icon-192.png" \
  "public/brand/logo.jpg" \
  "src/assets/hero.webp" \
  "frontend/src/assets/editor/preview.jpeg" \
  "docs/screenshots/reference.png" \
  "branding/logo.png" \
  "assets/release-approved/evidence.png" \
  "test-modal-screenshot.js" \
  "test-screenshot.js" \
  "qa/enterprise/human-handoff-screenshots.json"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo -e "${RED}${BOLD}PAYLOAD CONTAMINATION REGRESSION: FAIL${NC}"
  exit 1
fi

echo -e "${GREEN}${BOLD}PAYLOAD CONTAMINATION REGRESSION: PASS (${PASS_COUNT} checks)${NC}"
