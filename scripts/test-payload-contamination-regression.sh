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

make_payload_with_nested_zip() {
  local out_zip="$1"
  local tmp

  tmp="$(mktemp -d -t r-agent2-payload-regression-XXXXXX)"
  mkdir -p "$tmp/r-agent2/docs/nested" "$tmp/r-agent2/docs/archive"
  printf 'nested-content\n' > "$tmp/r-agent2/docs/nested/file.txt"
  (cd "$tmp/r-agent2/docs/nested" && zip -qr "$tmp/r-agent2/docs/archive/inner.zip" file.txt)
  (cd "$tmp" && zip -qr "$out_zip" r-agent2)
  rm -rf "$tmp"
}

make_payload_with_recursive_zip() {
  local out_zip="$1"
  local tmp

  tmp="$(mktemp -d -t r-agent2-payload-regression-XXXXXX)"
  mkdir -p "$tmp/r-agent2/docs/archive"
  printf 'seed\n' > "$tmp/r-agent2/docs/archive/seed.txt"
  (cd "$tmp/r-agent2/docs/archive" && zip -q recursive.zip seed.txt)
  cp "$tmp/r-agent2/docs/archive/recursive.zip" "$tmp/r-agent2/docs/archive/recursive-copy.zip"
  (cd "$tmp/r-agent2/docs/archive" && zip -q recursive.zip recursive-copy.zip)
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

expect_validation_finishes() {
  local label="$1"
  local expected="$2"
  local zip_path="$3"
  local tmp_log="/tmp/r-agent2-payload-regression.log"
  local rc

  if timeout 8s bash -c 'source "$1"; release_payload_validate_zip "$2" "$3"' _ "$SCRIPT_DIR/release-payload-blocklist.sh" "$zip_path" "$label" >"$tmp_log" 2>&1; then
    rc=0
  else
    rc=$?
  fi

  if [[ "$expected" == "PASS" && "$rc" -eq 0 ]]; then
    ok "validação determinística aceitou: $label"
  elif [[ "$expected" == "FAIL" && "$rc" -ne 0 && "$rc" -ne 124 ]]; then
    ok "validação determinística rejeitou: $label"
  elif [[ "$expected" == "TIMEOUT_FAIL" && "$rc" -ne 0 && "$rc" -ne 124 ]]; then
    ok "timeout defensivo falhou fechado: $label"
  else
    fail "validação inesperada para $label: rc=$rc esperado=$expected"
    sed 's/^/    /' "$tmp_log" || true
  fi
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

step "Validando estabilidade operacional de zips especiais"
NESTED_ZIP="$(mktemp -t r-agent2-nested-payload.XXXXXX.zip)"
rm -f "$NESTED_ZIP"
make_payload_with_nested_zip "$NESTED_ZIP"
expect_validation_finishes "nested-zip-offline" "PASS" "$NESTED_ZIP"
rm -f "$NESTED_ZIP"

RECURSIVE_ZIP="$(mktemp -t r-agent2-recursive-payload.XXXXXX.zip)"
rm -f "$RECURSIVE_ZIP"
make_payload_with_recursive_zip "$RECURSIVE_ZIP"
expect_validation_finishes "recursive-zip-no-recursive-unzip" "PASS" "$RECURSIVE_ZIP"
rm -f "$RECURSIVE_ZIP"

MALFORMED_ZIP="$(mktemp -t r-agent2-malformed-payload.XXXXXX.zip)"
printf 'not-a-zip\n' > "$MALFORMED_ZIP"
expect_validation_finishes "malformed-zip" "FAIL" "$MALFORMED_ZIP"
rm -f "$MALFORMED_ZIP"

TIMEOUT_ZIP="$(mktemp -t r-agent2-timeout-payload.XXXXXX.zip)"
rm -f "$TIMEOUT_ZIP"
make_payload_with_nested_zip "$TIMEOUT_ZIP"
if RELEASE_PAYLOAD_ZIP_TIMEOUT_SECONDS=0.001 timeout 8s bash -c 'source "$1"; release_payload_validate_zip "$2" timeout-fixture' _ "$SCRIPT_DIR/release-payload-blocklist.sh" "$TIMEOUT_ZIP" >/tmp/r-agent2-payload-regression.log 2>&1; then
  fail "timeout defensivo aceitou indevidamente"
else
  rc=$?
  if [[ "$rc" -eq 124 ]]; then
    fail "timeout externo disparou antes do timeout defensivo"
  else
    ok "timeout defensivo não vira PASS"
  fi
fi
rm -f "$TIMEOUT_ZIP"

STALE_TMP="$(mktemp -t r-agent2-payload-list.XXXXXX)"
touch -d '2 hours ago' "$STALE_TMP" 2>/dev/null || true
CLEAN_ZIP="$(mktemp -t r-agent2-cleanup-payload.XXXXXX.zip)"
rm -f "$CLEAN_ZIP"
make_payload_with_entries "$CLEAN_ZIP" "docs/cleanup.txt"
release_payload_validate_zip "$CLEAN_ZIP" cleanup-fixture >/tmp/r-agent2-payload-regression.log 2>&1 || fail "fixture de cleanup deveria passar"
if [[ -e "$STALE_TMP" ]]; then
  fail "arquivo temporário stale não removido"
  rm -f "$STALE_TMP"
else
  ok "cleanup removeu temporário stale"
fi
rm -f "$CLEAN_ZIP"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo -e "${RED}${BOLD}PAYLOAD CONTAMINATION REGRESSION: FAIL${NC}"
  exit 1
fi

echo -e "${GREEN}${BOLD}PAYLOAD CONTAMINATION REGRESSION: PASS (${PASS_COUNT} checks)${NC}"
