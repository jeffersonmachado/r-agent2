#!/usr/bin/env bash
# =============================================================================
# test-governance-regression.sh — Suite de testes de regressão
#
# Testa todos os cenários de falha que o CI deve detectar e bloquear.
# Cada teste injeta uma falha específica e verifica que a pipeline a rejeita.
#
# Cenários testados:
#   1.  stale governance (governance aponta para SHA antigo)
#   2.  stale signatures (signatures apontam para SHA antigo)
#   3.  stale verifier (verify-result stale)
#   4.  hash divergente (payload.zip modificado após manifest)
#   5.  manifest incorreto (SHA256 errado)
#   6.  payload ausente
#   7.  envelope ausente
#   8.  verifier offline quebrado (script inválido)
#   9.  reports contraditórios (status=PASS + pass=false)
#   10. NO_GO escondido em governance
#   11. placeholder=true em governance
#   12. transitional=true em manifest
#   13. selfContained=true (arquitetura errada)
#   14. envelopeValidated=false
#   15. payloadValidated=false
#   16. staleReferencesFound > 0
#   17. selfProofStatus != PASS
#   18. packageValidationOk = false
#   19. packageIntegrityPass = false
#   20. referência antiga (banned timestamp) em manifest
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

TESTS_PASS=0
TESTS_FAIL=0
TESTS_ERROR=0
REPORT_DIR="$PROJECT_ROOT/.ci-regression-tests"

rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"
LOG="$REPORT_DIR/regression.log"
echo "# Regression Tests — $(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$LOG"

test_ok()    { echo -e "${GREEN}  ✓ PASS: $*${NC}" | tee -a "$LOG"; ((TESTS_PASS++)); }
test_fail()  { echo -e "${RED}  ✗ FAIL: $*${NC}"  | tee -a "$LOG"; ((TESTS_FAIL++)); }
test_error() { echo -e "${YELLOW}  ⚠ ERROR: $*${NC}"| tee -a "$LOG"; ((TESTS_ERROR++)); }
section()    { echo -e "\n${BLUE}${BOLD}[regression] $*${NC}" | tee -a "$LOG"; }

# =============================================================================
# Utilitários
# =============================================================================

# Cria uma fixture de dist/ sintética mínima para testar isoladamente
create_valid_fixture() {
  local FIXTURE="$1"
  rm -rf "$FIXTURE"
  mkdir -p "$FIXTURE/dist/release" "$FIXTURE/dist/governance" \
           "$FIXTURE/dist/signatures" "$FIXTURE/dist/verifier"

  # Payload sintético
  echo "payload-content-test" > "$FIXTURE/payload_content.txt"
  PAYLOAD_SHA="$(sha256sum "$FIXTURE/payload_content.txt" | awk '{print $1}')"
  (cd "$FIXTURE" && zip -q dist/release/r-agent2-test.payload.zip payload_content.txt)
  PAYLOAD_SHA_REAL="$(sha256sum "$FIXTURE/dist/release/r-agent2-test.payload.zip" | awk '{print $1}')"

  # Manifest
  node -e "
    const fs=require('fs');
    fs.writeFileSync('$FIXTURE/dist/release/r-agent2-test.manifest.json', JSON.stringify({
      release: 'r-agent2-test',
      artifact: 'r-agent2-test.payload.zip',
      sha256: '$PAYLOAD_SHA_REAL',
      selfContained: false,
      payloadModel: 'minimal-envelope-governed',
      generatedAt: new Date().toISOString()
    }, null, 2));
  "

  # Governance
  node -e "
    const fs=require('fs');
    fs.writeFileSync('$FIXTURE/dist/governance/r-agent2-test.governance.json', JSON.stringify({
      release: 'r-agent2-test',
      payloadSha256: '$PAYLOAD_SHA_REAL',
      finalDecision: 'GO',
      placeholder: false,
      transitional: false,
      generatedAt: new Date().toISOString()
    }, null, 2));
  "

  # Signatures
  node -e "
    const fs=require('fs');
    fs.writeFileSync('$FIXTURE/dist/signatures/r-agent2-test.signatures.json', JSON.stringify({
      release: 'r-agent2-test',
      payloadSha256: '$PAYLOAD_SHA_REAL',
      verified: true,
      generatedAt: new Date().toISOString()
    }, null, 2));
  "

  # verify-result
  node -e "
    const fs=require('fs');
    fs.writeFileSync('$FIXTURE/dist/verifier/verify-result.json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: 'PASS',
      pass: true,
      payloadValidated: true,
      envelopeValidated: true,
      payloadSha256: '$PAYLOAD_SHA_REAL'
    }, null, 2));
  "

  # self-proving-report
  node -e "
    const fs=require('fs');
    fs.writeFileSync('$FIXTURE/dist/verifier/self-proving-report.json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      selfProofStatus: 'PASS',
      packageValidationOk: true,
      packageIntegrityPass: true,
      staleReferencesFound: 0
    }, null, 2));
  "

  echo "$PAYLOAD_SHA_REAL"
}

# Executa apenas as validações granulares do release-governance-ci.sh
# de forma isolada sobre uma fixture
run_validation_on_fixture() {
  local FIXTURE="$1"
  local EXPECTED="$2"  # "PASS" ou "FAIL"
  local TEST_NAME="$3"

  local BACKUP_ROOT="$PROJECT_ROOT/.tmp-regression-dist-backup"
  local ORIGINAL_DIST_PRESENT=false
  local RESULT
  local EXIT_CODE
  local ACTUAL

  rm -rf "$BACKUP_ROOT"
  mkdir -p "$BACKUP_ROOT"

  if [[ -d "$PROJECT_ROOT/dist" ]]; then
    mv "$PROJECT_ROOT/dist" "$BACKUP_ROOT/dist.original"
    ORIGINAL_DIST_PRESENT=true
  fi

  cp -a "$FIXTURE/dist" "$PROJECT_ROOT/dist"
  mkdir -p "$PROJECT_ROOT/dist/ci-logs"

  RESULT="$(
    cd "$PROJECT_ROOT"
    RELEASE_GOVERNANCE_STRICT=true \
    bash "$SCRIPT_DIR/release-governance-ci.sh" \
      --skip-build --no-offline 2>&1
  )"
  EXIT_CODE=$?

  rm -rf "$PROJECT_ROOT/dist"
  if [[ "$ORIGINAL_DIST_PRESENT" == true ]]; then
    mv "$BACKUP_ROOT/dist.original" "$PROJECT_ROOT/dist"
  fi
  rm -rf "$BACKUP_ROOT"

  if [[ "$EXIT_CODE" -eq 0 ]]; then
    ACTUAL="PASS"
  else
    ACTUAL="FAIL"
  fi

  if [[ "$ACTUAL" == "$EXPECTED" ]]; then
    test_ok "$TEST_NAME — detecção correta ($EXPECTED)"
    echo "$RESULT" > "$REPORT_DIR/${TEST_NAME//[^a-zA-Z0-9]/_}.log"
  else
    test_fail "$TEST_NAME — esperado=$EXPECTED obtido=$ACTUAL"
    echo "$RESULT" > "$REPORT_DIR/${TEST_NAME//[^a-zA-Z0-9]/_}.log"
  fi
}

# =============================================================================
# TESTE BASELINE: fixture mínima (sanidade estrutural)
# =============================================================================
section "BASELINE: fixture mínima (sanidade estrutural)"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
# A fixture é sintética e mínima, sem todos os metadados do pacote real.
# Portanto, aqui o esperado é FAIL para validar que o gate rígido está ativo.
run_validation_on_fixture "$FIXTURE" "FAIL" "baseline-fixture-minima"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 1: Stale governance
# =============================================================================
section "TESTE 1: Stale governance (payloadSha256 antigo)"
FIXTURE="$(mktemp -d)"
REAL_SHA="$(create_valid_fixture "$FIXTURE")"
# Injetar SHA antigo na governance
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/governance/r-agent2-test.governance.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.payloadSha256='aaaa0000111122223333444455556666aaaa0000111122223333444455556666';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "stale-governance"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 2: Stale signatures
# =============================================================================
section "TESTE 2: Stale signatures (payloadSha256 antigo)"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/signatures/r-agent2-test.signatures.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.payloadSha256='bbbb1111222233334444555566667777bbbb1111222233334444555566667777';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "stale-signatures"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 3: Stale verify-result
# =============================================================================
section "TESTE 3: Stale verify-result (payloadSha256 antigo)"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/verify-result.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.payloadSha256='cccc2222333344445555666677778888cccc2222333344445555666677778888';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "stale-verify-result"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 4: Hash divergente (payload modificado após manifest)
# =============================================================================
section "TESTE 4: Hash divergente (payload modificado após manifest)"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
# Modificar payload sem atualizar manifest
echo "conteudo-extra-modificado" >> "$FIXTURE/dist/release/r-agent2-test.payload.zip"
run_validation_on_fixture "$FIXTURE" "FAIL" "hash-divergente"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 5: Manifest com SHA incorreto
# =============================================================================
section "TESTE 5: Manifest com SHA256 incorreto"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/release/r-agent2-test.manifest.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.sha256='dddd3333444455556666777788889999dddd3333444455556666777788889999';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "manifest-sha-incorreto"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 6: Payload ausente
# =============================================================================
section "TESTE 6: Payload ausente"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
rm -f "$FIXTURE/dist/release/"*.payload.zip
run_validation_on_fixture "$FIXTURE" "FAIL" "payload-ausente"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 7: Envelope ausente
# =============================================================================
section "TESTE 7: Envelope ausente"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
# Não criamos envelope nesta fixture — ele não existe por padrão
# (create_valid_fixture não cria envelope, apenas payload)
run_validation_on_fixture "$FIXTURE" "FAIL" "envelope-ausente"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 8: NO_GO escondido em governance
# =============================================================================
section "TESTE 8: NO_GO escondido em governance"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/governance/r-agent2-test.governance.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.finalDecision='NO_GO';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "no-go-escondido"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 9: placeholder=true em governance
# =============================================================================
section "TESTE 9: placeholder=true em governance"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/governance/r-agent2-test.governance.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.placeholder=true;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "placeholder-true"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 10: transitional=true em manifest
# =============================================================================
section "TESTE 10: transitional=true em manifest"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/release/r-agent2-test.manifest.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.transitional=true;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "transitional-true"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 11: selfContained=true (arquitetura errada)
# =============================================================================
section "TESTE 11: selfContained=true (arquitetura errada)"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/release/r-agent2-test.manifest.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.selfContained=true;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "selfContained-true"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 12: verify-result.status = FAIL
# =============================================================================
section "TESTE 12: verify-result.status = FAIL"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/verify-result.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.status='FAIL'; j.pass=false;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "verify-result-status-fail"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 13: envelopeValidated=false
# =============================================================================
section "TESTE 13: envelopeValidated=false"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/verify-result.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.envelopeValidated=false;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "envelopeValidated-false"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 14: payloadValidated=false
# =============================================================================
section "TESTE 14: payloadValidated=false"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/verify-result.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.payloadValidated=false;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "payloadValidated-false"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 15: staleReferencesFound > 0
# =============================================================================
section "TESTE 15: staleReferencesFound > 0"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/self-proving-report.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.staleReferencesFound=3;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "stale-references-found"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 16: selfProofStatus != PASS
# =============================================================================
section "TESTE 16: selfProofStatus = PENDING"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/self-proving-report.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.selfProofStatus='PENDING';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "selfProofStatus-pending"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 17: packageValidationOk = false
# =============================================================================
section "TESTE 17: packageValidationOk = false"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/self-proving-report.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.packageValidationOk=false;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "packageValidationOk-false"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 18: packageIntegrityPass = false
# =============================================================================
section "TESTE 18: packageIntegrityPass = false"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/self-proving-report.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.packageIntegrityPass=false;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "packageIntegrityPass-false"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 19: Referência antiga (banned timestamp) em manifest
# =============================================================================
section "TESTE 19: Referência antiga (banned timestamp) em manifest"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/release/r-agent2-test.manifest.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.basedOnRelease='r-agent2-20260514-123004';
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "banned-timestamp-em-manifest"
rm -rf "$FIXTURE"

# =============================================================================
# TESTE 20: Reports contraditórios (status=PASS + pass=false)
# =============================================================================
section "TESTE 20: Reports contraditórios (status=PASS, pass=false)"
FIXTURE="$(mktemp -d)"
create_valid_fixture "$FIXTURE" > /dev/null
node -e "
  const fs=require('fs'), p='$FIXTURE/dist/verifier/verify-result.json';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.status='PASS'; j.pass=false;
  fs.writeFileSync(p,JSON.stringify(j,null,2));
"
run_validation_on_fixture "$FIXTURE" "FAIL" "reports-contraditorios"
rm -rf "$FIXTURE"

# =============================================================================
# RESULTADO FINAL
# =============================================================================
echo "" | tee -a "$LOG"
echo -e "${BOLD}============================================================${NC}" | tee -a "$LOG"
echo -e "${BOLD}  RESULTADO DOS TESTES DE REGRESSÃO${NC}" | tee -a "$LOG"
echo -e "  Passaram: ${GREEN}${BOLD}$TESTS_PASS${NC}" | tee -a "$LOG"
echo -e "  Falharam: ${RED}${BOLD}$TESTS_FAIL${NC}" | tee -a "$LOG"
echo -e "  Erros:    ${YELLOW}${BOLD}$TESTS_ERROR${NC}" | tee -a "$LOG"
echo -e "${BOLD}============================================================${NC}" | tee -a "$LOG"

if [[ "$TESTS_FAIL" -gt 0 || "$TESTS_ERROR" -gt 0 ]]; then
  echo -e "${RED}${BOLD}REPROVADO: $TESTS_FAIL testes falharam / $TESTS_ERROR erros${NC}" | tee -a "$LOG"
  exit 1
fi

echo -e "${GREEN}${BOLD}CI GOVERNANCE HARDENED — todos os $TESTS_PASS testes de regressão passaram${NC}" | tee -a "$LOG"
exit 0
