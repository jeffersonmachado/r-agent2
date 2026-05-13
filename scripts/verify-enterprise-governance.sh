#!/usr/bin/env bash
# =============================================================================
# verify-enterprise-governance.sh — Verificador offline de governança enterprise
#
# Valida completamente o pacote RAP sem dependência de sistemas externos.
#
# Verifica:
#   1. Integridade do pacote (SHA256 ZIP vs manifesto)
#   2. Cadeia de imutabilidade criptográfica (chainRoot)
#   3. Assinaturas HMAC-SHA256 (manifest, governance, release)
#   4. Atestado de governança (attestation seal)
#   5. Nível de maturidade (target: LEVEL_4_IMMUTABLE)
#   6. Detector de adulteração (tamper detection)
#   7. Decisão final autônoma
#
# Uso:
#   bash scripts/verify-enterprise-governance.sh
#   bash scripts/verify-enterprise-governance.sh --json     # saída JSON
#   bash scripts/verify-enterprise-governance.sh --zip <path>  # ZIP específico
#
# Requisitos:
#   - Node.js >=20
#   - sha256sum (GNU coreutils)
#
# Exit codes:
#   0 — PASS: toda a governança está íntegra
#   1 — FAIL: adulteração ou verificação incompleta detectada
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

JSON_MODE=false
TARGET_ZIP=""
OVERALL_PASS=true
STEP_RESULTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)  JSON_MODE=true; shift ;;
    --zip)   TARGET_ZIP="${2:?--zip requer caminho}"; shift 2 ;;
    -h|--help)
      sed -n '/^# Uso:/,/^# Requisitos:/p' "$0" | sed 's/^# *//'
      exit 0 ;;
    *) echo -e "${RED}Opção desconhecida: $1${NC}" >&2; exit 1 ;;
  esac
done

step()  { [[ "$JSON_MODE" == false ]] && echo -e "${BLUE}[verify] $*${NC}"; }
ok()    { [[ "$JSON_MODE" == false ]] && echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { [[ "$JSON_MODE" == false ]] && echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()  { [[ "$JSON_MODE" == false ]] && echo -e "${RED}  ✗ $*${NC}"; OVERALL_PASS=false; }
record(){ STEP_RESULTS+=("$1"); }

cd "$PROJECT_ROOT"

# ─── 1. Encontrar ZIP canônico ────────────────────────────────────────────────
step "1. Localizando pacote canônico..."

if [[ -n "$TARGET_ZIP" ]]; then
  ZIP_PATH="$TARGET_ZIP"
else
  ZIP_PATH="$(ls -t dist/r-agent2-*.zip 2>/dev/null | grep -v compact | head -1 || true)"
fi

if [[ -z "$ZIP_PATH" || ! -f "$ZIP_PATH" ]]; then
  fail "Nenhum ZIP de release encontrado em dist/"
  exit 1
fi

ZIP_NAME="$(basename "$ZIP_PATH")"
MANIFEST_PATH="${ZIP_PATH%.zip}.manifest.json"

ok "ZIP: $ZIP_NAME"
record "package_found:PASS"

# ─── 2. Integridade do pacote (SHA256) ───────────────────────────────────────
step "2. Verificando integridade do pacote (SHA256)..."

COMPUTED_HASH="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"

if [[ -f "$MANIFEST_PATH" ]]; then
  RECORDED_HASH="$(node -e "
    const fs=require('fs');
    const m=JSON.parse(fs.readFileSync('$MANIFEST_PATH','utf8'));
    process.stdout.write(m.sha256||'');
  " 2>/dev/null || echo '')"

  if [[ "$COMPUTED_HASH" == "$RECORDED_HASH" && -n "$RECORDED_HASH" ]]; then
    ok "SHA256 verificado: ${COMPUTED_HASH:0:24}…"
    record "package_integrity:PASS:$COMPUTED_HASH"
  else
    fail "Hash divergente! Computed=${COMPUTED_HASH:0:24}… Recorded=${RECORDED_HASH:0:24}…"
    record "package_integrity:FAIL"
    OVERALL_PASS=false
  fi
else
  warn "Manifesto sidecar não encontrado: $MANIFEST_PATH"
  record "package_integrity:WARN:no_sidecar"
fi

# ─── 3. Cadeia de imutabilidade ───────────────────────────────────────────────
step "3. Verificando cadeia de imutabilidade criptográfica..."

if [[ -f "governance/governance-chain.json" ]]; then
  CHAIN_RESULT="$(node governance/governance-chain.js --verify 2>&1)"
  CHAIN_EXIT=$?
  if [[ $CHAIN_EXIT -eq 0 ]]; then
    CHAIN_ROOT="$(node -e "
      const c=require('./governance/governance-chain.json');
      process.stdout.write(c.chainRoot.slice(0,24)+'...');
    " 2>/dev/null || echo 'unknown')"
    ok "Cadeia íntegra — chainRoot=${CHAIN_ROOT}"
    record "immutability_chain:PASS"
  else
    FAILURES="$(echo "$CHAIN_RESULT" | node -e "
      let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{
        try{const r=JSON.parse(d);process.stdout.write(JSON.stringify(r.failures||[]));}
        catch(e){process.stdout.write('parse_error');}
      });
    " 2>/dev/null || echo '[]')"
    fail "Cadeia ADULTERADA ou inválida. Falhas: $FAILURES"
    record "immutability_chain:FAIL"
    OVERALL_PASS=false
  fi
else
  warn "governance/governance-chain.json não encontrada. Execute: node governance/governance-chain.js"
  record "immutability_chain:WARN:not_generated"
fi

# ─── 4. Assinaturas HMAC ─────────────────────────────────────────────────────
step "4. Verificando assinaturas HMAC-SHA256..."

for SIG_FILE in dist/release.sig dist/governance.sig dist/package.manifest.sig; do
  if [[ -f "$SIG_FILE" ]]; then
    SIG_VALID="$(node -e "
      const fs=require('fs');
      const {verifySeal}=require('./governance/sign-governance');
      const sig=JSON.parse(fs.readFileSync('$SIG_FILE','utf8'));
      process.stdout.write(verifySeal(sig)?'true':'false');
    " 2>/dev/null || echo 'false')"

    if [[ "$SIG_VALID" == "true" ]]; then
      ok "$(basename $SIG_FILE): VÁLIDA"
      record "sig_$(basename $SIG_FILE .sig):PASS"
    else
      fail "$(basename $SIG_FILE): INVÁLIDA ou adulterada"
      record "sig_$(basename $SIG_FILE .sig):FAIL"
      OVERALL_PASS=false
    fi
  else
    fail "Assinatura ausente: $SIG_FILE"
    record "sig_$(basename $SIG_FILE .sig):FAIL:missing"
    OVERALL_PASS=false
  fi
done

# ─── 5. Atestado de governança ────────────────────────────────────────────────
step "5. Verificando atestado de governança..."

if [[ -f "dist/governance-attestation.json" ]]; then
  ATT_RESULT="$(node -e "
    const fs=require('fs');
    const {verifySeal}=require('./governance/sign-governance');
    const att=JSON.parse(fs.readFileSync('dist/governance-attestation.json','utf8'));
    const sig=att.signatures?.attestation;
    if(!sig){process.stdout.write(JSON.stringify({valid:false,reason:'no_sig'}));process.exit(0);}
    const valid=verifySeal(sig);
    process.stdout.write(JSON.stringify({
      valid,
      decision: att.finalDecision,
      level:    att.governanceLevel,
      score:    att.governanceIntegrity?.overallConsistencyScore
    }));
  " 2>/dev/null || echo '{"valid":false}')"

  ATT_VALID="$(  echo "$ATT_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{try{process.stdout.write(String(JSON.parse(d).valid));}catch(e){process.stdout.write('false');}})" 2>/dev/null || echo 'false')"
  ATT_DECISION="$(echo "$ATT_RESULT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).decision||'?');}catch(e){process.stdout.write('?');}})" 2>/dev/null || echo '?')"

  if [[ "$ATT_VALID" == "true" ]]; then
    ok "Attestation: VÁLIDA — decision=$ATT_DECISION"
    record "attestation:PASS:$ATT_DECISION"
  else
    fail "Attestation INVÁLIDA ou adulterada"
    record "attestation:FAIL"
    OVERALL_PASS=false
  fi
else
  fail "dist/governance-attestation.json não encontrada"
  record "attestation:FAIL:missing"
  OVERALL_PASS=false
fi

# ─── 6. Detector de adulteração ──────────────────────────────────────────────
step "6. Executando detector de adulteração..."

if node governance/tamper-detector.js > /dev/null 2>&1; then
  ok "Nenhuma adulteração detectada"
  record "tamper_detection:PASS"
else
  FAILED_CHECKS="$(node -e "
    const fs=require('fs');
    const r=JSON.parse(fs.readFileSync('governance/tamper-detection-report.json','utf8'));
    const f=(r.checks||[]).filter(c=>!c.pass).map(c=>c.check).join(',');
    process.stdout.write(f||'unknown');
  " 2>/dev/null || echo 'unknown')"
  fail "Adulteração detectada em: $FAILED_CHECKS"
  record "tamper_detection:FAIL:$FAILED_CHECKS"
  OVERALL_PASS=false
fi

# ─── 7. Nível de maturidade ───────────────────────────────────────────────────
step "7. Avaliando nível de maturidade de governança..."

node governance/governance-maturity.js > /dev/null 2>&1 || true
MATURITY_LEVEL="$(node -e "
  const fs=require('fs');
  const r=JSON.parse(fs.readFileSync('governance/governance-maturity-report.json','utf8'));
  process.stdout.write(r.achievedLevel+'(target:'+r.targetLevel+')');
" 2>/dev/null || echo 'unknown')"
MATURITY_TARGET_OK="$(node -e "
  const fs=require('fs');
  const r=JSON.parse(fs.readFileSync('governance/governance-maturity-report.json','utf8'));
  process.stdout.write(String(r.targetAchieved===true));
" 2>/dev/null || echo 'false')"

if [[ "$MATURITY_TARGET_OK" == "true" ]]; then
  ok "Maturidade: $MATURITY_LEVEL"
  record "maturity:PASS"
else
  warn "Maturidade: $MATURITY_LEVEL (target não atingido)"
  record "maturity:WARN"
fi

# ─── 8. Decisão final ────────────────────────────────────────────────────────
step "8. Verificando decisão final autônoma..."

FINAL_DECISION="$(node -e "
  const r=require('./governance/final-proof-report.json');
  process.stdout.write(r.finalDecision||'UNKNOWN');
" 2>/dev/null || echo 'UNKNOWN')"

if [[ "$FINAL_DECISION" == "AUTONOMOUS_READY_GO" ]]; then
  ok "finalDecision: $FINAL_DECISION"
  record "final_decision:PASS:$FINAL_DECISION"
else
  warn "finalDecision: $FINAL_DECISION (não é AUTONOMOUS_READY_GO)"
  record "final_decision:WARN:$FINAL_DECISION"
fi

# ─── Resultado final ─────────────────────────────────────────────────────────
echo ""
if [[ "$JSON_MODE" == true ]]; then
  STEPS_JSON="$(printf '"%s",' "${STEP_RESULTS[@]}")"
  STEPS_JSON="[${STEPS_JSON%,}]"
  node -e "
    process.stdout.write(JSON.stringify({
      generatedAt:   new Date().toISOString(),
      zip:           '$ZIP_NAME',
      zipSha256:     '$COMPUTED_HASH',
      pass:          $( [[ "$OVERALL_PASS" == true ]] && echo 'true' || echo 'false'),
      decision:      '$( [[ "$OVERALL_PASS" == true ]] && echo 'VERIFIED' || echo 'TAMPERED_OR_INCOMPLETE')',
      steps:         $STEPS_JSON,
      finalDecision: '$FINAL_DECISION',
    }, null, 2));
  " 2>/dev/null
else
  echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
  if [[ "$OVERALL_PASS" == true ]]; then
    echo -e "${GREEN}${BOLD}  GOVERNANCE VERIFICATION: PASS${NC}"
    echo -e "${GREEN}  Pacote: $ZIP_NAME${NC}"
    echo -e "${GREEN}  SHA256: ${COMPUTED_HASH:0:32}…${NC}"
    echo -e "${GREEN}  Decisão: $FINAL_DECISION${NC}"
  else
    echo -e "${RED}${BOLD}  GOVERNANCE VERIFICATION: FAIL${NC}"
    echo -e "${RED}  Adulteração ou configuração incompleta detectada.${NC}"
    echo -e "${RED}  Execute: node governance/tamper-detector.js para detalhes.${NC}"
  fi
  echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
fi

[[ "$OVERALL_PASS" == true ]] && exit 0 || exit 1
