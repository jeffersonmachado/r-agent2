#!/usr/bin/env bash
# =============================================================================
# release-governance-ci.sh — Pipeline central de governança ENVELOPE + PAYLOAD
#
# Executa a cadeia completa de validação antes de qualquer release.
# Se qualquer etapa falhar, a pipeline inteira falha (exit != 0).
#
# USO:
#   bash scripts/release-governance-ci.sh
#   RELEASE_GOVERNANCE_STRICT=true bash scripts/release-governance-ci.sh
#   bash scripts/release-governance-ci.sh --skip-build
#   bash scripts/release-governance-ci.sh --json-report
#
# MODO STRICT (RELEASE_GOVERNANCE_STRICT=true):
#   - Qualquer warning vira FAIL
#   - Qualquer transitional vira FAIL
#   - Qualquer stale vira FAIL
#   - Qualquer referência antiga vira FAIL
#
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

STRICT_MODE="${RELEASE_GOVERNANCE_STRICT:-false}"
SKIP_BUILD=false
JSON_REPORT=false
OFFLINE_TEST=true
CI_LOG_DIR="$PROJECT_ROOT/dist/ci-logs"
CI_LOG="$CI_LOG_DIR/ci-governance-audit.log"

# Timestamps banidos — referências de releases antigas que NÃO devem aparecer
# em artifacts finais (governance, signatures, manifest, verify-result).
# NÃO aplicado a: docs/history, scripts, changelogs, blocklists.
source "$SCRIPT_DIR/release-governance-blocklist.sh"

PASS=true
FAIL_REASONS=()
WARN_REASONS=()

step()   { echo -e "\n${BLUE}${BOLD}[ci-gov] $*${NC}" | tee -a "$CI_LOG"; }
ok()     { echo -e "${GREEN}  ✓ $*${NC}"               | tee -a "$CI_LOG"; }
warn()   { echo -e "${YELLOW}  ⚠ WARNING: $*${NC}"     | tee -a "$CI_LOG"; WARN_REASONS+=("$*"); }
fail()   { echo -e "${RED}  ✗ FAIL: $*${NC}"           | tee -a "$CI_LOG"; PASS=false; FAIL_REASONS+=("$*"); }
info()   { echo -e "${CYAN}  ℹ $*${NC}"               | tee -a "$CI_LOG"; }

strict_fail() {
  if [[ "$STRICT_MODE" == "true" ]]; then
    fail "$1 [STRICT]"
  else
    warn "$1"
  fi
}

# =============================================================================
# Argumentos
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)   SKIP_BUILD=true; shift ;;
    --json-report)  JSON_REPORT=true; shift ;;
    --no-offline)   OFFLINE_TEST=false; shift ;;
    -h|--help)
      echo "Uso: bash scripts/release-governance-ci.sh [--skip-build] [--json-report] [--no-offline]"
      echo "     RELEASE_GOVERNANCE_STRICT=true bash scripts/release-governance-ci.sh"
      exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"
mkdir -p dist dist/ci-logs

# Inicializar log limpo
mkdir -p "$CI_LOG_DIR"
echo "# CI Governance Log — $(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$CI_LOG"
echo "STRICT_MODE=$STRICT_MODE" >> "$CI_LOG"

echo -e "${BOLD}${CYAN}"
echo "============================================================"
echo "  RELEASE GOVERNANCE CI — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  STRICT_MODE=$STRICT_MODE"
echo "============================================================"
echo -e "${NC}"

# =============================================================================
# ETAPA 1: Build
# =============================================================================
step "ETAPA 1: Build e geração do release"

if [[ "$SKIP_BUILD" == "true" ]]; then
  info "skip-build ativo — pulando npm ci + zip:release"
else
  info "Executando npm ci..."
  npm ci --prefer-offline 2>&1 | tail -5 || npm ci 2>&1 | tail -5
  ok "npm ci concluído"

  info "Executando npm run zip:release..."
  npm run zip:release 2>&1 | tail -20
  ok "zip:release concluído"
fi

# =============================================================================
# ETAPA 2: Validação estrutural dist/
# =============================================================================
step "ETAPA 2: Validação estrutural (check-dist-clean)"

# Resíduo de execuções anteriores da suíte de regressão não deve contaminar
# a validação estrutural do pacote de release.
rm -rf "$PROJECT_ROOT/dist/regression-tests"

if bash "$SCRIPT_DIR/check-dist-clean.sh" 2>&1 | tee -a "$CI_LOG"; then
  ok "check-dist-clean PASSOU"
else
  fail "check-dist-clean FALHOU"
fi

# =============================================================================
# ETAPA 3: Verificação enterprise (wrapper)
# =============================================================================
step "ETAPA 3: verify-enterprise-governance (wrapper oficial)"

if bash "$SCRIPT_DIR/verify-enterprise-governance.sh" 2>&1 | tee -a "$CI_LOG"; then
  ok "verify-enterprise-governance PASSOU"
else
  fail "verify-enterprise-governance FALHOU"
fi

# =============================================================================
# ETAPA 4: Verificação enterprise v2 (rígida)
# =============================================================================
step "ETAPA 4: verify-enterprise-governance-v2 (verificação rígida)"

if bash "$SCRIPT_DIR/verify-enterprise-governance-v2.sh" 2>&1 | tee -a "$CI_LOG"; then
  ok "verify-enterprise-governance-v2 PASSOU"
else
  fail "verify-enterprise-governance-v2 FALHOU"
fi

# =============================================================================
# ETAPA 5: Auditoria profunda final
# =============================================================================
step "ETAPA 5: audit-envelope-release-final (auditoria profunda)"

if bash "$SCRIPT_DIR/audit-envelope-release-final.sh" 2>&1 | tee -a "$CI_LOG"; then
  ok "audit-envelope-release-final PASSOU"
else
  fail "audit-envelope-release-final FALHOU"
fi

# =============================================================================
# ETAPA 6: Validações granulares de artifacts
# =============================================================================
step "ETAPA 6: Validações granulares de artifacts"

DIST_RELEASE="dist/release"
DIST_GOV="dist/governance"
DIST_SIG="dist/signatures"
DIST_VER="dist/verifier"

PAYLOAD_PATH="$(ls -t "$DIST_RELEASE"/*.payload.zip 2>/dev/null | head -1 || true)"
ENVELOPE_PATH="$(ls -t "$DIST_RELEASE"/*.zip 2>/dev/null | grep -v '\.payload\.zip' | head -1 || true)"

# Existência obrigatória
[[ -n "$PAYLOAD_PATH"  && -f "$PAYLOAD_PATH"  ]] && ok "payload existe: $(basename "$PAYLOAD_PATH")"  || fail "payload AUSENTE em $DIST_RELEASE/"
[[ -n "$ENVELOPE_PATH" && -f "$ENVELOPE_PATH" ]] && ok "envelope existe: $(basename "$ENVELOPE_PATH")" || fail "envelope AUSENTE em $DIST_RELEASE/"

if [[ -z "$PAYLOAD_PATH" || -z "$ENVELOPE_PATH" ]]; then
  echo -e "${RED}${BOLD}ABORTANDO: payload/envelope ausentes — sem condições de continuar${NC}"
  exit 1
fi

PAYLOAD_SHA="$(sha256sum "$PAYLOAD_PATH" | awk '{print $1}')"
PAYLOAD_NAME="$(basename "$PAYLOAD_PATH")"
MANIFEST_PATH="$DIST_RELEASE/${PAYLOAD_NAME%.payload.zip}.manifest.json"

# Manifest
[[ -f "$MANIFEST_PATH" ]] && ok "manifest existe" || fail "manifest AUSENTE"

if [[ -f "$MANIFEST_PATH" ]]; then
  M_SHA="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.sha256||'')}catch(e){}" "$MANIFEST_PATH" 2>/dev/null || echo '')"
  M_ART="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.artifact||'')}catch(e){}" "$MANIFEST_PATH" 2>/dev/null || echo '')"
  M_SC="$(node -e  "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.selfContained))}catch(e){}" "$MANIFEST_PATH" 2>/dev/null || echo '')"

  # SHA256 do payload bate com manifest
  if [[ "$M_SHA" == "$PAYLOAD_SHA" ]]; then
    ok "manifest.sha256 confere com payload real"
  else
    fail "manifest.sha256 DIVERGENTE — manifest='$M_SHA' real='$PAYLOAD_SHA'"
  fi

  # selfContained deve ser false (arquitetura minimal-envelope-governed)
  if [[ "$M_SC" == "false" ]]; then
    ok "manifest.selfContained=false (arquitetura minimal-envelope-governed correta)"
  else
    fail "manifest.selfContained INVÁLIDO='$M_SC' (esperado false)"
  fi

  # artifact deve terminar em .payload.zip
  if [[ "$M_ART" == *.payload.zip ]]; then
    ok "manifest.artifact aponta para payload"
  else
    fail "manifest.artifact INVÁLIDO='$M_ART'"
  fi
fi

# Governance externo aponta para payload correto
# Buscar o arquivo que efetivamente contém payloadSha256
G_SHA=""
for gf in "$DIST_GOV"/*.json; do
  [[ -f "$gf" ]] || continue
  VAL="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(j.payloadSha256) process.stdout.write(j.payloadSha256)}catch(e){}" "$gf" 2>/dev/null || echo '')"
  if [[ -n "$VAL" ]]; then G_SHA="$VAL"; GOV_FILE="$gf"; break; fi
done
if [[ -n "$G_SHA" ]]; then
  if [[ "$G_SHA" == "$PAYLOAD_SHA" ]]; then
    ok "governance.payloadSha256 confere ($(basename "$GOV_FILE"))"
  else
    fail "governance.payloadSha256 STALE — gov='$G_SHA' real='$PAYLOAD_SHA'"
  fi
else
  fail "governance ausente ou sem payloadSha256 em $DIST_GOV/"
fi

# Signatures externas apontam para payload correto
SIG_FILES=()
for ext in json sig; do
  for f in "$DIST_SIG"/*.$ext; do [[ -f "$f" ]] && SIG_FILES+=("$f"); done
done
if [[ "${#SIG_FILES[@]}" -gt 0 ]]; then
  SIG_FILE="${SIG_FILES[0]}"
  S_SHA="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.payloadSha256||j.artifactSha256||j.sha256||'')}catch(e){}" "$SIG_FILE" 2>/dev/null || echo '')"
  if [[ "$S_SHA" == "$PAYLOAD_SHA" ]]; then
    ok "signatures.payloadSha256 confere"
  else
    fail "signatures.payloadSha256 STALE — sig='$S_SHA' real='$PAYLOAD_SHA'"
  fi
else
  fail "signatures ausentes em $DIST_SIG/"
fi

# verify-result.status
VR_PATH="$(ls -t "$DIST_VER"/verify-result*.json 2>/dev/null | head -1 || true)"
if [[ -n "$VR_PATH" && -f "$VR_PATH" ]]; then
  VR_STATUS="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.status||'')}catch(e){}" "$VR_PATH" 2>/dev/null || echo '')"
  VR_PASS="$(node -e   "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.pass))}catch(e){}" "$VR_PATH" 2>/dev/null || echo '')"
  VR_SHA="$(node -e    "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.payloadSha256||'')}catch(e){}" "$VR_PATH" 2>/dev/null || echo '')"
  VR_EV="$(node -e     "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.envelopeValidated))}catch(e){}" "$VR_PATH" 2>/dev/null || echo '')"
  VR_PV="$(node -e     "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.payloadValidated))}catch(e){}" "$VR_PATH" 2>/dev/null || echo '')"

  [[ "$VR_STATUS" == "PASS" ]]     && ok "verify-result.status=PASS"          || fail "verify-result.status='$VR_STATUS' (esperado PASS)"
  [[ "$VR_PASS"   == "true" ]]     && ok "verify-result.pass=true"             || fail "verify-result.pass='$VR_PASS' (esperado true)"
  [[ "$VR_EV"     == "true" ]]     && ok "verify-result.envelopeValidated=true"|| fail "verify-result.envelopeValidated='$VR_EV'"
  [[ "$VR_PV"     == "true" ]]     && ok "verify-result.payloadValidated=true" || fail "verify-result.payloadValidated='$VR_PV'"
  [[ "$VR_SHA"    == "$PAYLOAD_SHA" ]] && ok "verify-result.payloadSha256 confere" || fail "verify-result.payloadSha256 STALE"
else
  fail "verify-result.json ausente em $DIST_VER/"
fi

# self-proving-report — pode estar em dist/governance/ ou dist/verifier/
SP_PATH=""
for candidate in "$DIST_GOV/self-proving-report.json" "$(ls -t "$DIST_VER"/self-proving-report*.json 2>/dev/null | head -1)"; do
  [[ -n "$candidate" && -f "$candidate" ]] && SP_PATH="$candidate" && break
done
if [[ -n "$SP_PATH" && -f "$SP_PATH" ]]; then
  SP_STATUS="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.selfProofStatus||j.status||'')}catch(e){}" "$SP_PATH" 2>/dev/null || echo '')"
  SP_PKG_OK="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.packageValidationOk))}catch(e){}" "$SP_PATH" 2>/dev/null || echo '')"
  SP_PKG_INT="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.packageIntegrityPass))}catch(e){}" "$SP_PATH" 2>/dev/null || echo '')"
  SP_STALE="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(j.staleReferencesFound||0))}catch(e){process.stdout.write('0')}" "$SP_PATH" 2>/dev/null || echo '0')"
  SP_MANIFEST_HASH="$(node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(j.manifestHash||'')}catch(e){}" "$SP_PATH" 2>/dev/null || echo '')"
  REAL_MANIFEST_HASH="$(sha256sum "$MANIFEST_PATH" | awk '{print $1}')"

  [[ "$SP_STATUS" == "PASS" ]]   && ok "self-proving.selfProofStatus=PASS"       || fail "self-proving.selfProofStatus='$SP_STATUS' (esperado PASS)"
  [[ "$SP_PKG_OK"  == "true" ]]  && ok "self-proving.packageValidationOk=true"   || fail "self-proving.packageValidationOk='$SP_PKG_OK'"
  [[ "$SP_PKG_INT" == "true" ]]  && ok "self-proving.packageIntegrityPass=true"  || fail "self-proving.packageIntegrityPass='$SP_PKG_INT'"
  [[ "$SP_STALE"   == "0" ]]     && ok "self-proving.staleReferencesFound=0"     || fail "self-proving.staleReferencesFound=$SP_STALE (deve ser 0)"
  [[ "$SP_MANIFEST_HASH" == "$REAL_MANIFEST_HASH" ]] && ok "self-proving.manifestHash confere" || fail "self-proving.manifestHash STALE — sp='$SP_MANIFEST_HASH' real='$REAL_MANIFEST_HASH'"
else
  fail "self-proving-report.json ausente em $DIST_VER/"
fi

# Tokens proibidos em artifacts finais
step "ETAPA 6b: Tokens proibidos (placeholder/transitional/pending/NO_GO)"

for f in "$MANIFEST_PATH"; do
  [[ -f "$f" ]] && ARTIFACT_FILES+=("$f")
done
for dir in "$DIST_GOV" "$DIST_SIG" "$DIST_VER"; do
  for f in "$dir"/*.json "$dir"/*.sig; do
    [[ -f "$f" ]] && ARTIFACT_FILES+=("$f")
  done
done

FOUND_TOKENS=false
for f in "${ARTIFACT_FILES[@]}"; do
  if tr '[:lower:]' '[:upper:]' < "$f" | grep -Eq '"PLACEHOLDER"[[:space:]]*:[[:space:]]*TRUE|"TRANSITIONAL"[[:space:]]*:[[:space:]]*TRUE|STATUS.*PENDING|NO_GO'; then
    fail "token proibido encontrado em $(basename "$f")"
    FOUND_TOKENS=true
  fi
done
[[ "$FOUND_TOKENS" == false ]] && ok "sem tokens proibidos em artifacts"

# =============================================================================
# ETAPA 7: Verificação de referências antigas (banned timestamps)
# =============================================================================
step "ETAPA 7: Referências antigas (banned timestamps) em artifacts finais"

BANNED_FOUND=false
for ts in "${BANNED_TIMESTAMPS[@]}"; do
  for f in "${ARTIFACT_FILES[@]}"; do
    if grep -q "$ts" "$f" 2>/dev/null; then
      # Ignorar se for uma blocklist oficial de auditoria (campo bannedTimestamps)
      if node -e "
        try {
          const j=JSON.parse(require('fs').readFileSync('$f','utf8'));
          const banned = j.bannedTimestamps || j.bannedList || [];
          if (banned.includes('$ts')) process.exit(0); else process.exit(1);
        } catch(e) { process.exit(1); }
      " 2>/dev/null; then
        : # É uma referência esperada na blocklist oficial — ok
      else
        strict_fail "referência antiga '$ts' em $(basename "$f")"
        BANNED_FOUND=true
      fi
    fi
  done
done
[[ "$BANNED_FOUND" == false ]] && ok "sem referências antigas em artifacts finais"

# =============================================================================
# ETAPA 8: Verifier offline
# =============================================================================
if [[ "$OFFLINE_TEST" == "true" ]]; then
  step "ETAPA 8: Teste do verifier offline"

  TMPDIR_OFFLINE="$(mktemp -d)"
  OFFLINE_RESULT=0
  OFFLINE_LOG="$CI_LOG_DIR/ci-offline-test.log"
  # Resolver path absoluto do envelope ANTES de entrar no subshell com cd
  ENVELOPE_ABS="$(cd "$(dirname "$ENVELOPE_PATH")" && pwd)/$(basename "$ENVELOPE_PATH")"

  {
    echo "# Offline verifier test — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "Extraindo envelope: $ENVELOPE_ABS"
    cd "$TMPDIR_OFFLINE"
    unzip -q "$ENVELOPE_ABS"
    ls -la

    VERIFIER_SCRIPT=""
    if [[ -f "r-agent2/dist/verifier/verify-enterprise-governance.sh" ]]; then
      VERIFIER_SCRIPT="r-agent2/dist/verifier/verify-enterprise-governance.sh"
    elif [[ -f "dist/verifier/verify-enterprise-governance.sh" ]]; then
      VERIFIER_SCRIPT="dist/verifier/verify-enterprise-governance.sh"
    else
      echo "ERRO: verifier não encontrado no envelope extraído"
      ls -R . | grep "verify-enterprise" || true
      exit 1
    fi

    chmod +x "$VERIFIER_SCRIPT" 2>/dev/null || true
    echo "Executando: bash $VERIFIER_SCRIPT"
    bash "$VERIFIER_SCRIPT"
  } > "$OFFLINE_LOG" 2>&1 || OFFLINE_RESULT=$?

  cat "$OFFLINE_LOG" | tee -a "$CI_LOG"
  rm -rf "$TMPDIR_OFFLINE"
  cd "$PROJECT_ROOT"

  if [[ "$OFFLINE_RESULT" -eq 0 ]]; then
    ok "verifier offline executou com sucesso (exit 0)"
  else
    fail "verifier offline FALHOU (exit $OFFLINE_RESULT)"
  fi
fi

# =============================================================================
# RELATÓRIO JSON final
# =============================================================================
if [[ "$JSON_REPORT" == "true" ]]; then
  REPORT_PATH="$PROJECT_ROOT/dist/ci-logs/ci-governance-report.json"
  FAIL_JSON="$(printf '"%s",' "${FAIL_REASONS[@]+"${FAIL_REASONS[@]}"}" | sed 's/,$//')"
  WARN_JSON="$(printf '"%s",' "${WARN_REASONS[@]+"${WARN_REASONS[@]}"}" | sed 's/,$//')"
  node -e "
    const fs = require('fs');
    const report = {
      generatedAt: new Date().toISOString(),
      pipeline: 'release-governance-ci',
      strictMode: '${STRICT_MODE}',
      pass: ${PASS},
      failReasons: [${FAIL_JSON}],
      warnReasons: [${WARN_JSON}],
      payloadSha256: '${PAYLOAD_SHA:-}',
      artifacts: {
        payload: '$(basename "${PAYLOAD_PATH:-}")',
        envelope: '$(basename "${ENVELOPE_PATH:-}")',
        manifest: '$(basename "${MANIFEST_PATH:-}")',
      }
    };
    fs.writeFileSync('$REPORT_PATH', JSON.stringify(report, null, 2));
    console.log('JSON report: $REPORT_PATH');
  " 2>/dev/null || true
fi

# =============================================================================
# DECISÃO FINAL
# =============================================================================
echo "" | tee -a "$CI_LOG"
echo -e "${BOLD}============================================================${NC}" | tee -a "$CI_LOG"

if [[ "${#FAIL_REASONS[@]}" -gt 0 ]]; then
  echo -e "${RED}${BOLD}REPROVADO: ${FAIL_REASONS[0]}${NC}" | tee -a "$CI_LOG"
  echo "" | tee -a "$CI_LOG"
  for r in "${FAIL_REASONS[@]}"; do
    echo -e "${RED}  ✗ $r${NC}" | tee -a "$CI_LOG"
  done
  echo -e "${BOLD}============================================================${NC}" | tee -a "$CI_LOG"
  exit 1
fi

if [[ "${#WARN_REASONS[@]}" -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}AVISOS (não bloqueantes em modo não-strict):${NC}" | tee -a "$CI_LOG"
  for r in "${WARN_REASONS[@]}"; do
    echo -e "${YELLOW}  ⚠ $r${NC}" | tee -a "$CI_LOG"
  done
fi

echo -e "${GREEN}${BOLD}CI GOVERNANCE HARDENED${NC}" | tee -a "$CI_LOG"
echo -e "${BOLD}============================================================${NC}" | tee -a "$CI_LOG"
exit 0
