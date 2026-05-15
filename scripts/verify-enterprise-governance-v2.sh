#!/usr/bin/env bash
# =============================================================================
# verify-enterprise-governance-v2.sh — Verificação rígida ENVELOPE + PAYLOAD
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Execução suportada em dois cenários:
# 1) Repositório: <root>/scripts/verify-enterprise-governance-v2.sh
# 2) Offline pacote: <root>/dist/verifier/verify-enterprise-governance-v2.sh
if [[ -d "$SCRIPT_DIR/../release" && -d "$SCRIPT_DIR/../governance" && -d "$SCRIPT_DIR/../signatures" ]]; then
  DIST_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  PROJECT_ROOT="$(cd "$DIST_ROOT/.." && pwd)"
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  DIST_ROOT="$PROJECT_ROOT/dist"
fi

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

JSON_MODE=false
TARGET_ENVELOPE=""
TARGET_PAYLOAD=""
OVERALL_PASS=true
REASONS=()
STEPS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_MODE=true; shift ;;
    --envelope) TARGET_ENVELOPE="${2:?--envelope requer caminho}"; shift 2 ;;
    --payload) TARGET_PAYLOAD="${2:?--payload requer caminho}"; shift 2 ;;
    -h|--help)
      echo "Uso: bash scripts/verify-enterprise-governance-v2.sh [--json] [--envelope <path>] [--payload <path>]"
      exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

step() { [[ "$JSON_MODE" == false ]] && echo -e "${BLUE}[verify-v2] $*${NC}" || true; STEPS+=("$*"); }
ok() { [[ "$JSON_MODE" == false ]] && echo -e "${GREEN}  ✓ $*${NC}" || true; }
warn() { [[ "$JSON_MODE" == false ]] && echo -e "${YELLOW}  ⚠ $*${NC}" || true; }
fail() {
  [[ "$JSON_MODE" == false ]] && echo -e "${RED}  ✗ $*${NC}" || true
  OVERALL_PASS=false
  REASONS+=("$*")
}

contains_forbidden_tokens() {
  local file="$1"
  tr '[:lower:]' '[:upper:]' < "$file" | grep -Eq '"PLACEHOLDER"[[:space:]]*:[[:space:]]*TRUE|"TRANSITIONAL"[[:space:]]*:[[:space:]]*TRUE|"STATUS"[[:space:]]*:[[:space:]]*"PENDING"|NO_GO|PENDING'
}

if [[ -f "$SCRIPT_DIR/release-governance-blocklist.sh" ]]; then
  source "$SCRIPT_DIR/release-governance-blocklist.sh"
else
  source "$PROJECT_ROOT/scripts/release-governance-blocklist.sh"
fi

check_banned_hashes() {
  local log_path="$1"
  shift
  : > "$log_path"
  local found=false
  local hash
  for hash in "${BANNED_HASHES[@]}"; do
    if grep -RIn "$hash" "$@" >> "$log_path" 2>/dev/null; then
      fail "Referência stale detectada: $hash"
      found=true
    fi
  done
  [[ "$found" == false ]] && rm -f "$log_path"
}

check_banned_timestamps() {
  local log_path="$1"
  shift
  : > "$log_path"
  local found=false
  local ts
  for ts in "${BANNED_TIMESTAMPS[@]}"; do
    if grep -RIn "$ts" "$@" >> "$log_path" 2>/dev/null; then
      fail "Referência antiga detectada: $ts"
      found=true
    fi
  done
  [[ "$found" == false ]] && rm -f "$log_path"
}

write_verify_result() {
  local status="$1"
  local pass_bool="$2"
  local verifier_dir="$PROJECT_ROOT/dist/verifier"
  mkdir -p "$verifier_dir"

  local reasons_json steps_json
  reasons_json="$(printf '"%s",' "${REASONS[@]+"${REASONS[@]}"}")"
  reasons_json="[${reasons_json%,}]"
  steps_json="$(printf '"%s",' "${STEPS[@]+"${STEPS[@]}"}")"
  steps_json="[${steps_json%,}]"

  node -e "
    const fs=require('fs');
    const out={
      generatedAt:new Date().toISOString(),
      verifier:'verify-enterprise-governance-v2.sh',
      status:'${status}',
      pass:${pass_bool},
      payloadValidated:${pass_bool},
      envelopeValidated:${pass_bool},
      governedArtifactType:'payload',
      payload:'${PAYLOAD_NAME:-}',
      payloadSha256:'${PAYLOAD_SHA:-}',
      manifest:'${MANIFEST_NAME:-}',
      envelope:'${ENVELOPE_NAME:-}',
      failReasons:${reasons_json}.filter(Boolean),
      steps:${steps_json}.filter(Boolean)
    };
    fs.writeFileSync('${verifier_dir}/verify-result.json', JSON.stringify(out,null,2)+'\\n','utf8');
  " 2>/dev/null || true
}

cd "$PROJECT_ROOT" || exit 1
DIST_RELEASE="$DIST_ROOT/release"
DIST_GOV="$DIST_ROOT/governance"
DIST_SIG="$DIST_ROOT/signatures"
DIST_VER="$DIST_ROOT/verifier"

step "1. Localizando payload/envelope/manifest"
if [[ -n "$TARGET_PAYLOAD" ]]; then
  PAYLOAD_PATH="$TARGET_PAYLOAD"
else
  PAYLOAD_PATH="$(ls -t "$DIST_RELEASE"/*.payload.zip 2>/dev/null | head -1 || true)"
fi

if [[ -n "$TARGET_ENVELOPE" ]]; then
  ENVELOPE_PATH="$TARGET_ENVELOPE"
else
  ENVELOPE_PATH="$(ls -t "$DIST_RELEASE"/*.zip 2>/dev/null | grep -v '.payload.zip' | head -1 || true)"
fi

[[ -n "$PAYLOAD_PATH" && -f "$PAYLOAD_PATH" ]] || fail "Payload ausente"
if [[ -n "$ENVELOPE_PATH" && -f "$ENVELOPE_PATH" ]]; then
  ENVELOPE_AVAILABLE=true
else
  ENVELOPE_AVAILABLE=false
fi

if [[ "$OVERALL_PASS" == false ]]; then
  write_verify_result "FAIL" false
  [[ "$JSON_MODE" == true ]] && cat "$DIST_VER/verify-result.json"
  exit 1
fi

PAYLOAD_NAME="$(basename "$PAYLOAD_PATH")"
if [[ "$ENVELOPE_AVAILABLE" == true ]]; then
  ENVELOPE_NAME="$(basename "$ENVELOPE_PATH")"
else
  ENVELOPE_NAME=""
fi
MANIFEST_NAME="${PAYLOAD_NAME%.payload.zip}.manifest.json"
MANIFEST_PATH="$DIST_RELEASE/$MANIFEST_NAME"
PAYLOAD_SHA="$(sha256sum "$PAYLOAD_PATH" | awk '{print $1}')"

[[ -f "$MANIFEST_PATH" ]] || fail "Manifest ausente: $MANIFEST_PATH"
[[ "$OVERALL_PASS" == true ]] && ok "Artefatos localizados"

step "2. Validando manifest payload-centric"
if [[ -f "$MANIFEST_PATH" ]]; then
  MANIFEST_SHA="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8'));process.stdout.write(m.sha256||'');" 2>/dev/null || echo '')"
  MANIFEST_ARTIFACT="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8'));process.stdout.write(m.artifact||'');" 2>/dev/null || echo '')"
  MANIFEST_GA="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8'));process.stdout.write(m.governedArtifact||'');" 2>/dev/null || echo '')"
  MANIFEST_TYPE="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8'));process.stdout.write(m.artifactType||'');" 2>/dev/null || echo '')"

  [[ "$MANIFEST_SHA" == "$PAYLOAD_SHA" ]] || fail "Manifest sha256 divergente"
  [[ "$MANIFEST_ARTIFACT" == "$PAYLOAD_NAME" ]] || fail "Manifest artifact divergente"
  [[ "$MANIFEST_GA" == "$PAYLOAD_NAME" ]] || fail "Manifest governedArtifact divergente"
  [[ "$MANIFEST_TYPE" == "payload" ]] || fail "Manifest artifactType != payload"
  if contains_forbidden_tokens "$MANIFEST_PATH"; then
    fail "Manifest com tokens proibidos"
  fi
fi

step "3. Validando conteúdo obrigatório do envelope (zip ou descompactado)"
if [[ "$ENVELOPE_AVAILABLE" == true ]]; then
  ENVELOPE_LIST="$(unzip -l "$ENVELOPE_PATH" 2>/dev/null || true)"
  for item in \
    "r-agent2/dist/release/$PAYLOAD_NAME" \
    "r-agent2/dist/release/$MANIFEST_NAME" \
    "r-agent2/dist/governance/" \
    "r-agent2/dist/signatures/" \
    "r-agent2/dist/verifier/"
  do
    grep -q "$(echo "$item" | sed 's/\//\\\//g')" <<< "$ENVELOPE_LIST" || fail "Envelope sem item obrigatório: $item"
  done
else
  for item in \
    "$DIST_RELEASE/$PAYLOAD_NAME" \
    "$DIST_RELEASE/$MANIFEST_NAME" \
    "$DIST_GOV" \
    "$DIST_SIG" \
    "$DIST_VER"
  do
    [[ -e "$item" ]] || fail "Envelope descompactado sem item obrigatório: $item"
  done
fi

step "4. Validando governance e signatures externos"
for req in payload-governance.json governance-chain.json governance-attestation.json self-proving-report.json package-validation-report.json package-integrity-report.json final-governance-report.json; do
  [[ -f "$DIST_GOV/$req" ]] || fail "Governance externo ausente: $req"
done
for sig in governance.sig release.sig package.manifest.sig replay.sig; do
  [[ -f "$DIST_SIG/$sig" ]] || fail "Signature externa ausente: $sig"
done

if [[ -f "$DIST_GOV/payload-governance.json" ]]; then
  GOV_HASH="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/payload-governance.json','utf8'));process.stdout.write(j.governedHash||'');" 2>/dev/null || echo '')"
  [[ "$GOV_HASH" == "$PAYLOAD_SHA" ]] || fail "payload-governance externo aponta hash diferente do payload"
fi

if [[ -f "$DIST_GOV/governance-chain.json" ]]; then
  CHAIN_HASH="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/governance-chain.json','utf8'));process.stdout.write(j.chainRoot||'');" 2>/dev/null || echo '')"
  [[ "$CHAIN_HASH" == "$PAYLOAD_SHA" ]] || fail "governance-chain externo aponta hash diferente do payload"
fi

if [[ -f "$DIST_GOV/governance-attestation.json" ]]; then
  AT_PAYLOAD="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/governance-attestation.json','utf8'));process.stdout.write(j.payloadRef||'');" 2>/dev/null || echo '')"
  [[ "$AT_PAYLOAD" == "$PAYLOAD_NAME" ]] || fail "governance-attestation externo payloadRef divergente"
fi

for json in "$DIST_GOV"/*.json; do
  [[ -f "$json" ]] || continue
  contains_forbidden_tokens "$json" && fail "Governance externo contém tokens proibidos: $(basename "$json")"
done

for sig in "$DIST_SIG"/*.sig; do
  [[ -f "$sig" ]] || continue
  SIG_CHECK="$(node -e "
    const fs=require('fs');
    const crypto=require('crypto');
    const p=process.argv[1];
    const payloadSha=process.argv[2];
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    const sigName=require('path').basename(p);
    const expected=crypto.createHash('sha256').update(payloadSha+':'+sigName+':'+(j.releaseId||'')).digest('hex');
    const ok=(j.placeholder===false && j.transitional===false && (j.status==='valid' || j.status==='final') && j.artifact && j.algorithm==='sha256' && (j.payloadSha256===payloadSha || j.artifactSha256===payloadSha) && j.signature===expected);
    process.stdout.write(String(ok));
  " "$sig" "$PAYLOAD_SHA" 2>/dev/null || echo false)"
  [[ "$SIG_CHECK" == "true" ]] || fail "Signature externa inválida: $(basename "$sig")"
done

step "5. Validando estrutura interna do payload (modelo mínimo envelope-governed)"
TMP="$(mktemp -d -t r-agent2-audit-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
if [[ "$ENVELOPE_AVAILABLE" == true ]]; then
  unzip -qq "$ENVELOPE_PATH" -d "$TMP/envelope" 2>/dev/null || true
fi
unzip -qq "$PAYLOAD_PATH" -d "$TMP/payload" 2>/dev/null || true

IN_GOV_DIR="$TMP/payload/r-agent2/dist/governance"
IN_SIG_DIR="$TMP/payload/r-agent2/dist/signatures"
if [[ -d "$IN_GOV_DIR" ]]; then
  warn "Payload contém governance interno; no modelo mínimo isso é opcional e não é fonte de verdade"
  for json in "$IN_GOV_DIR"/*.json; do
    [[ -f "$json" ]] || continue
    contains_forbidden_tokens "$json" && fail "Governance interno contém tokens proibidos: $(basename "$json")"
  done
fi
if [[ -d "$IN_SIG_DIR" ]]; then
  warn "Payload contém signatures internas; no modelo mínimo isso é opcional e não é fonte de verdade"
  for sig in "$IN_SIG_DIR"/*.sig; do
    [[ -f "$sig" ]] || continue
    contains_forbidden_tokens "$sig" && fail "Signature interna contém tokens proibidos: $(basename "$sig")"
  done
fi

step "6. Validando verifier offline externo"
for vf in verify-enterprise-governance.sh verify-enterprise-governance-v2.sh verify-result.json; do
  [[ -f "$DIST_VER/$vf" ]] || fail "Verifier externo incompleto: falta $vf"
done
if [[ ! -x "$DIST_VER/verify-enterprise-governance.sh" ]]; then
  chmod +x "$DIST_VER/verify-enterprise-governance.sh" 2>/dev/null || true
fi
if [[ ! -x "$DIST_VER/verify-enterprise-governance-v2.sh" ]]; then
  chmod +x "$DIST_VER/verify-enterprise-governance-v2.sh" 2>/dev/null || true
fi
[[ -x "$DIST_VER/verify-enterprise-governance.sh" ]] || fail "verify-enterprise-governance.sh não executável"
[[ -x "$DIST_VER/verify-enterprise-governance-v2.sh" ]] || fail "verify-enterprise-governance-v2.sh não executável"

step "7. Validando verify-result e self-proving"
if [[ -f "$DIST_VER/verify-result.json" ]]; then
  VR_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_VER/verify-result.json','utf8')); const ok=(j && j.governedArtifactType==='payload' && typeof j.status==='string' && typeof j.payloadValidated==='boolean' && typeof j.envelopeValidated==='boolean'); process.stdout.write(String(ok));" 2>/dev/null || echo false)"
  [[ "$VR_OK" == "true" ]] || fail "verify-result.json fora do contrato estrutural"
else
  fail "verify-result.json ausente"
fi

if [[ -f "$DIST_GOV/self-proving-report.json" ]]; then
  SP_OK="$(node -e "const fs=require('fs'),crypto=require('crypto'); const j=JSON.parse(fs.readFileSync('$DIST_GOV/self-proving-report.json','utf8')); const manifestHash=crypto.createHash('sha256').update(fs.readFileSync('$MANIFEST_PATH')).digest('hex'); const ok=(j.pass===true&&j.verifierPassed===true&&j.selfProofStatus==='PASS'&&j.governedArtifactType==='payload'&&j.payloadValidated===true&&j.envelopeValidated===true&&j.offlineAuditability===true&&j.packageValidationOk===true&&j.packageIntegrityPass===true&&j.staleReferencesFound===0&&j.manifestHash===manifestHash); process.stdout.write(String(ok));" 2>/dev/null || echo false)"
  [[ "$SP_OK" == "true" ]] || fail "self-proving-report.json incompleto"
else
  fail "self-proving-report.json ausente"
fi

step "8. Verificando referências antigas proibidas"
VERIFY_STALE_LOG="$(mktemp -t verify-v2-stale.XXXXXX)"
check_banned_hashes "$VERIFY_STALE_LOG" "$DIST_GOV" "$DIST_SIG" "$MANIFEST_PATH"
VERIFY_TS_LOG="$(mktemp -t verify-v2-stale-ts.XXXXXX)"
check_banned_timestamps "$VERIFY_TS_LOG" "$DIST_GOV" "$DIST_SIG" "$MANIFEST_PATH"

echo ""
if [[ "$OVERALL_PASS" == true ]]; then
  write_verify_result "PASS" true
  [[ "$JSON_MODE" == false ]] && echo -e "${GREEN}${BOLD}✓ VERIFICAÇÃO RÍGIDA PASSOU${NC}"
  [[ "$JSON_MODE" == true ]] && cat "$DIST_VER/verify-result.json"
  exit 0
else
  write_verify_result "FAIL" false
  [[ "$JSON_MODE" == false ]] && echo -e "${RED}${BOLD}✗ VERIFICAÇÃO RÍGIDA FALHOU${NC}"
  [[ "$JSON_MODE" == true ]] && cat "$DIST_VER/verify-result.json"
  exit 1
fi
