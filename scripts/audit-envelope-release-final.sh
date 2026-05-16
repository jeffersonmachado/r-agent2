#!/usr/bin/env bash
# =============================================================================
# audit-envelope-release-final.sh — Auditoria profunda final ENVELOPE + PAYLOAD
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/../release" && -d "$SCRIPT_DIR/../governance" && -d "$SCRIPT_DIR/../signatures" ]]; then
  DIST_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  PROJECT_ROOT="$(cd "$DIST_ROOT/.." && pwd)"
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  DIST_ROOT="$PROJECT_ROOT/dist"
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=true
REASONS=()

step() { echo -e "${BLUE}[audit-final] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; PASS=false; REASONS+=("$*"); }

contains_forbidden_tokens() {
  local file="$1"
  tr '[:lower:]' '[:upper:]' < "$file" | grep -Eq '"PLACEHOLDER"[[:space:]]*:[[:space:]]*TRUE|"TRANSITIONAL"[[:space:]]*:[[:space:]]*TRUE|"STATUS"[[:space:]]*:[[:space:]]*"PENDING"|NO_GO|PENDING'
}

if [[ -f "$SCRIPT_DIR/release-governance-blocklist.sh" ]]; then
  source "$SCRIPT_DIR/release-governance-blocklist.sh"
else
  source "$PROJECT_ROOT/scripts/release-governance-blocklist.sh"
fi
if [[ -f "$SCRIPT_DIR/release-payload-blocklist.sh" ]]; then
  source "$SCRIPT_DIR/release-payload-blocklist.sh"
else
  source "$PROJECT_ROOT/scripts/release-payload-blocklist.sh"
fi

check_banned_hashes() {
  local log_path="$1"
  shift
  : > "$log_path"
  local found=false
  local hash
  for hash in "${BANNED_HASHES[@]}"; do
    if grep -RIn "$hash" "$@" >> "$log_path" 2>/dev/null; then
      fail "hash stale detectado: $hash"
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
      fail "referência antiga detectada: $ts"
      found=true
    fi
  done
  [[ "$found" == false ]] && rm -f "$log_path"
}

cd "$PROJECT_ROOT"

DIST_RELEASE="$DIST_ROOT/release"
DIST_GOV="$DIST_ROOT/governance"
DIST_SIG="$DIST_ROOT/signatures"
DIST_VER="$DIST_ROOT/verifier"

step "1. Localizar payload e envelope"
PAYLOAD_PATH="$(ls -t "$DIST_RELEASE"/*.payload.zip 2>/dev/null | head -1 || true)"
ENVELOPE_PATH="$(ls -t "$DIST_RELEASE"/*.zip 2>/dev/null | grep -v '.payload.zip' | head -1 || true)"

[[ -n "$PAYLOAD_PATH" && -f "$PAYLOAD_PATH" ]] && ok "payload localizado" || fail "payload ausente"
if [[ -n "$ENVELOPE_PATH" && -f "$ENVELOPE_PATH" ]]; then
  ENVELOPE_AVAILABLE=true
  ok "envelope localizado"
else
  ENVELOPE_AVAILABLE=false
  ok "envelope externo não embutido; validando dist/ como envelope descompactado"
fi

if [[ "$PASS" == false ]]; then
  echo -e "${RED}${BOLD}REPROVADO: payload ausente${NC}"
  exit 1
fi

PAYLOAD_NAME="$(basename "$PAYLOAD_PATH")"
ENVELOPE_NAME=""
[[ "$ENVELOPE_AVAILABLE" == true ]] && ENVELOPE_NAME="$(basename "$ENVELOPE_PATH")"
PAYLOAD_SHA="$(sha256sum "$PAYLOAD_PATH" | awk '{print $1}')"
MANIFEST_PATH="$DIST_RELEASE/${PAYLOAD_NAME%.payload.zip}.manifest.json"

step "2. Validar manifest"
[[ -f "$MANIFEST_PATH" ]] || fail "manifest ausente"
if [[ -f "$MANIFEST_PATH" ]]; then
  M_SHA="$(node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')); process.stdout.write(j.sha256||'')" 2>/dev/null || echo '')"
  M_ART="$(node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')); process.stdout.write(j.artifact||'')" 2>/dev/null || echo '')"
  [[ "$M_SHA" == "$PAYLOAD_SHA" ]] && ok "manifest sha256 confere" || fail "manifest sha256 divergente"
  [[ "$M_ART" == "$PAYLOAD_NAME" ]] && ok "manifest artifact confere" || fail "manifest artifact divergente"
fi

step "3. Extrair envelope e payload"
TMP="$(mktemp -d -t r-agent2-final-audit-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
if [[ "$ENVELOPE_AVAILABLE" == true ]]; then
  release_envelope_validate_zip "$ENVELOPE_PATH" || fail "envelope contém entradas inesperadas"
  unzip -qq "$ENVELOPE_PATH" -d "$TMP/envelope" 2>/dev/null || fail "falha ao extrair envelope"
else
  for d in "$DIST_RELEASE" "$DIST_GOV" "$DIST_SIG" "$DIST_VER"; do
    [[ -d "$d" ]] || fail "envelope descompactado incompleto: $d"
  done
fi
release_payload_validate_zip "$PAYLOAD_PATH" "$PAYLOAD_NAME" || fail "payload contém arquivo proibido"
unzip -qq "$PAYLOAD_PATH" -d "$TMP/payload" 2>/dev/null || fail "falha ao extrair payload"

IN_GOV="$TMP/payload/r-agent2/dist/governance"
IN_SIG="$TMP/payload/r-agent2/dist/signatures"
IN_VER="$TMP/payload/r-agent2/dist/verifier"

step "4. Validar governance externo (fonte de verdade) e interno opcional"
for req in payload-governance.json governance-chain.json governance-attestation.json self-proving-report.json package-validation-report.json package-integrity-report.json final-governance-report.json; do
  [[ -f "$DIST_GOV/$req" ]] || fail "externo ausente: $req"
  if [[ -d "$IN_GOV" ]]; then
    [[ -f "$IN_GOV/$req" ]] || warn "interno ausente: $req"
  fi
done

if [[ -f "$DIST_GOV/payload-governance.json" ]]; then
  GH="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/payload-governance.json','utf8')); process.stdout.write(j.governedHash||'')" 2>/dev/null || echo '')"
  [[ "$GH" == "$PAYLOAD_SHA" ]] && ok "payload-governance externo sincronizado" || fail "payload-governance externo stale"
fi
if [[ -f "$IN_GOV/payload-governance.json" ]]; then
  GH="$(node -e "const j=JSON.parse(require('fs').readFileSync('$IN_GOV/payload-governance.json','utf8')); process.stdout.write(j.governedHash||'')" 2>/dev/null || echo '')"
  [[ -n "$GH" ]] && ok "payload-governance interno presente" || warn "payload-governance interno sem governedHash"
fi

for g in "$DIST_GOV"/*.json "$IN_GOV"/*.json; do
  [[ -f "$g" ]] || continue
  contains_forbidden_tokens "$g" && fail "token proibido em $(basename "$g")"
done

step "5. Validar signatures externas e internas opcionais"
for req in governance.sig release.sig package.manifest.sig replay.sig; do
  [[ -f "$DIST_SIG/$req" ]] || fail "signature externa ausente: $req"
  if [[ -d "$IN_SIG" ]]; then
    [[ -f "$IN_SIG/$req" ]] || warn "signature interna ausente: $req"
  fi
done

validate_sig_dir() {
  local dir="$1"
  local scope="$2"
  for s in governance.sig release.sig package.manifest.sig replay.sig; do
    local p="$dir/$s"
    [[ -f "$p" ]] || continue
    local ok_sig
    ok_sig="$(node -e "
      const fs=require('fs');
      const crypto=require('crypto');
      const p=process.argv[1];
      const payloadSha=process.argv[2];
      const j=JSON.parse(fs.readFileSync(p,'utf8'));
      const s=require('path').basename(p);
      const expected=crypto.createHash('sha256').update(payloadSha+':'+s+':'+(j.releaseId||'')).digest('hex');
      const ok=(j.artifact && (j.artifactSha256===payloadSha || j.payloadSha256===payloadSha) && j.algorithm==='sha256' && (j.status==='valid' || j.status==='final') && j.placeholder===false && j.transitional===false && j.signature===expected);
      process.stdout.write(String(ok));
    " "$p" "$PAYLOAD_SHA" 2>/dev/null || echo false)"
    [[ "$ok_sig" == "true" ]] || fail "signature $scope inválida: $s"
  done
}

validate_sig_dir "$DIST_SIG" "externa"
if [[ -d "$IN_SIG" ]]; then
  for s in governance.sig release.sig package.manifest.sig replay.sig; do
    p="$IN_SIG/$s"
    [[ -f "$p" ]] || continue
    contains_forbidden_tokens "$p" && fail "signature interna contém token proibido: $s"
  done
fi

step "6. Validar verifier externo e interno"
for vf in verify-enterprise-governance.sh verify-enterprise-governance-v2.sh verify-result.json; do
  [[ -f "$DIST_VER/$vf" ]] || fail "verifier externo ausente: $vf"
  if [[ -d "$IN_VER" ]]; then
    [[ -f "$IN_VER/$vf" ]] || warn "verifier interno ausente: $vf"
  fi
done
[[ -x "$DIST_VER/verify-enterprise-governance.sh" ]] || fail "verify-enterprise-governance.sh externo não executável"
[[ -x "$DIST_VER/verify-enterprise-governance-v2.sh" ]] || fail "verify-enterprise-governance-v2.sh externo não executável"

step "7. Validar verify-result"
if [[ -f "$DIST_VER/verify-result.json" ]]; then
  VR_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_VER/verify-result.json','utf8')); process.stdout.write(String(j && j.governedArtifactType==='payload' && typeof j.status==='string' && typeof j.payloadValidated==='boolean' && typeof j.envelopeValidated==='boolean'));" 2>/dev/null || echo false)"
  [[ "$VR_OK" == "true" ]] && ok "verify-result válido" || fail "verify-result inválido"
else
  fail "verify-result ausente"
fi

step "8. Validar self-proving/package-validation/package-integrity"
if [[ -f "$DIST_GOV/self-proving-report.json" ]]; then
  SP_OK="$(node -e "const fs=require('fs'),crypto=require('crypto'); const j=JSON.parse(fs.readFileSync('$DIST_GOV/self-proving-report.json','utf8')); const manifestHash=crypto.createHash('sha256').update(fs.readFileSync('$MANIFEST_PATH')).digest('hex'); process.stdout.write(String(j.pass===true&&j.verifierPassed===true&&j.selfProofStatus==='PASS'&&j.governedArtifactType==='payload'&&j.payloadValidated===true&&j.envelopeValidated===true&&j.offlineAuditability===true&&j.packageValidationOk===true&&j.packageIntegrityPass===true&&j.staleReferencesFound===0&&j.manifestHash===manifestHash));" 2>/dev/null || echo false)"
  [[ "$SP_OK" == "true" ]] && ok "self-proving completo" || fail "self-proving incompleto"
fi
if [[ -f "$DIST_GOV/package-validation-report.json" ]]; then
  PV_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/package-validation-report.json','utf8')); process.stdout.write(String(j.ok===true));" 2>/dev/null || echo false)"
  [[ "$PV_OK" == "true" ]] || fail "package-validation-report.ok != true"
fi
if [[ -f "$DIST_GOV/package-integrity-report.json" ]]; then
  PI_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/package-integrity-report.json','utf8')); process.stdout.write(String(j.pass===true));" 2>/dev/null || echo false)"
  [[ "$PI_OK" == "true" ]] || fail "package-integrity-report.pass != true"
fi

step "9. Procurar referências antigas e hashes stale"
AUDIT_STALE_LOG="$(mktemp -t audit-stale.XXXXXX)"
check_banned_hashes "$AUDIT_STALE_LOG" "$DIST_GOV" "$DIST_SIG" "$IN_GOV" "$IN_SIG"
AUDIT_TS_LOG="$(mktemp -t audit-stale-ts.XXXXXX)"
check_banned_timestamps "$AUDIT_TS_LOG" "$DIST_GOV" "$DIST_SIG" "$IN_GOV" "$IN_SIG"

step "10. Rodar verifier rígido"
VERIFY_SCRIPT="$PROJECT_ROOT/scripts/verify-enterprise-governance-v2.sh"
[[ -f "$DIST_VER/verify-enterprise-governance-v2.sh" ]] && VERIFY_SCRIPT="$DIST_VER/verify-enterprise-governance-v2.sh"
VERIFY_ARGS=(--payload "$PAYLOAD_PATH")
if [[ "$ENVELOPE_AVAILABLE" == true ]]; then
  VERIFY_ARGS+=(--envelope "$ENVELOPE_PATH")
fi
if bash "$VERIFY_SCRIPT" "${VERIFY_ARGS[@]}" >/tmp/audit-v2.log 2>&1; then
  ok "verify-enterprise-governance-v2 PASS"
else
  fail "verify-enterprise-governance-v2 FAIL"
  tail -n 30 /tmp/audit-v2.log | sed 's/^/    /' || true
fi

if [[ "$PASS" == true ]]; then
  echo -e "${GREEN}${BOLD}ACEITO: RELEASE SELF-PROVING VERDE${NC}"
  exit 0
fi

echo -e "${RED}${BOLD}REPROVADO: falhas técnicas detectadas${NC}"
for r in "${REASONS[@]}"; do
  echo -e "${RED}  - $r${NC}"
done
exit 1
