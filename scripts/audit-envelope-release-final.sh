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
VALIDATOR_TIMEOUT_SECONDS="${VALIDATOR_TIMEOUT_SECONDS:-45}"

step() { echo -e "${BLUE}[audit-final] $*${NC}"; }
ok() { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; PASS=false; REASONS+=("$*"); }

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout --signal=TERM --kill-after=5s "${seconds}s" "$@"
  else
    "$@"
  fi
}

cleanup_tmp() {
  [[ -n "${TMP:-}" && -d "${TMP:-}" ]] && rm -rf "$TMP"
}

cleanup_stale_tmp_dirs() {
  run_with_timeout 5 find /tmp -maxdepth 1 -type d -name 'r-agent2-final-audit-*' -mmin +60 -exec rm -rf {} + >/dev/null 2>&1 || true
  run_with_timeout 5 find /tmp -maxdepth 1 -type d -name 'r-agent2-audit-*' -mmin +60 -exec rm -rf {} + >/dev/null 2>&1 || true
}

contains_forbidden_tokens() {
  local file="$1"
  # Alinhado ao verify-enterprise-governance-v2.sh: NO_GO/PENDING exigem
  # fronteiras não-identifier — decisões reais ("decision":"NO_GO") bloqueiam,
  # mas rótulos legítimos ("go_no_go", "DELIVERED_PENDING_SCORECARD") não são
  # contaminação.
  tr '[:lower:]' '[:upper:]' < "$file" | grep -Eq '"PLACEHOLDER"[[:space:]]*:[[:space:]]*TRUE|"TRANSITIONAL"[[:space:]]*:[[:space:]]*TRUE|"STATUS"[[:space:]]*:[[:space:]]*"PENDING"|(^|[^A-Z0-9_])NO_GO([^A-Z0-9_]|$)|(^|[^A-Z0-9_])PENDING([^A-Z0-9_]|$)'
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
  local target
  for hash in "${BANNED_HASHES[@]}"; do
    for target in "$@"; do
      [[ -e "$target" ]] || continue
      if [[ -d "$target" ]]; then
        while IFS= read -r file; do
          if run_with_timeout 5 grep -In "$hash" "$file" >> "$log_path" 2>/dev/null; then
            fail "hash stale detectado: $hash"
            found=true
          fi
        done < <(run_with_timeout 5 find "$target" -maxdepth 1 -type f \( -name '*.json' -o -name '*.sig' \) -print 2>/dev/null || true)
      elif run_with_timeout 5 grep -In "$hash" "$target" >> "$log_path" 2>/dev/null; then
        fail "hash stale detectado: $hash"
        found=true
      fi
    done
  done
  [[ "$found" == false ]] && rm -f "$log_path"
}

check_banned_timestamps() {
  local log_path="$1"
  shift
  : > "$log_path"
  local found=false
  local ts
  local target
  for ts in "${BANNED_TIMESTAMPS[@]}"; do
    for target in "$@"; do
      [[ -e "$target" ]] || continue
      if [[ -d "$target" ]]; then
        while IFS= read -r file; do
          if run_with_timeout 5 grep -In "$ts" "$file" >> "$log_path" 2>/dev/null; then
            fail "referência antiga detectada: $ts"
            found=true
          fi
        done < <(run_with_timeout 5 find "$target" -maxdepth 1 -type f \( -name '*.json' -o -name '*.sig' \) -print 2>/dev/null || true)
      elif run_with_timeout 5 grep -In "$ts" "$target" >> "$log_path" 2>/dev/null; then
        fail "referência antiga detectada: $ts"
        found=true
      fi
    done
  done
  [[ "$found" == false ]] && rm -f "$log_path"
}

cd "$PROJECT_ROOT"
cleanup_stale_tmp_dirs

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
trap cleanup_tmp EXIT
if [[ "$ENVELOPE_AVAILABLE" == true ]]; then
  release_envelope_validate_zip "$ENVELOPE_PATH" || fail "envelope contém entradas inesperadas"
  release_payload_extract_zip "$ENVELOPE_PATH" "$TMP/envelope" 2>/dev/null || fail "falha/timeout ao extrair envelope"
else
  for d in "$DIST_RELEASE" "$DIST_GOV" "$DIST_SIG" "$DIST_VER"; do
    [[ -d "$d" ]] || fail "envelope descompactado incompleto: $d"
  done
fi
release_payload_validate_zip "$PAYLOAD_PATH" "$PAYLOAD_NAME" || fail "payload contém arquivo proibido"
release_payload_extract_zip "$PAYLOAD_PATH" "$TMP/payload" 2>/dev/null || fail "falha/timeout ao extrair payload"

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
for req in governance.sig release.sig package.manifest.sig replay.sig release-attestation.sig; do
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
    # Sigs Model A (sign-governance): HMAC-SHA256 real com chave fora do
    # pacote. Offline não é possível recomputar o HMAC (por design — a chave
    # não viaja); valida-se a estrutura e a autenticidade é ancorada no
    # attestation Ed25519 (verificado pelo passo 10 → verify-payload-governance).
    local ok_sig
    ok_sig="$(node -e "
      const fs=require('fs');
      const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
      const ok=(j && j.signatureVersion===2 && j.algorithm==='hmac-sha256' && typeof j.seal==='string' && /^[0-9a-f]{64}$/.test(j.seal) && typeof j.gitCommit==='string' && /^[0-9a-f]{40}$/.test(j.gitCommit));
      process.stdout.write(String(ok));
    " "$p" 2>/dev/null || echo false)"
    [[ "$ok_sig" == "true" ]] || fail "signature $scope inválida: $s (esperado HMAC-SHA256 signatureVersion=2)"
  done
  # Attestation Ed25519: estrutura mínima aqui; verificação criptográfica real
  # acontece no verify-payload-governance.js (passo 10).
  local att="$dir/release-attestation.sig"
  if [[ -f "$att" ]]; then
    local ok_att
    ok_att="$(node -e "
      const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const ok=(j && j.algorithm==='ed25519' && typeof j.signature==='string' && j.signature.length>0 && j.attestation && typeof j.attestation.payloadSha256==='string');
      process.stdout.write(String(ok));
    " "$att" 2>/dev/null || echo false)"
    [[ "$ok_att" == "true" ]] || fail "release-attestation.sig $scope malformado"
  fi
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
# verify-result.json NÃO é obrigatório: é autogratificação escrita pela própria
# execução do verifier — a prova real são os gates desta auditoria (passo 10).
for vf in verify-enterprise-governance.sh verify-enterprise-governance-v2.sh verify-payload-governance.js release-attestation-public-key.json; do
  [[ -f "$DIST_VER/$vf" ]] || fail "verifier externo ausente: $vf"
  if [[ -d "$IN_VER" ]]; then
    [[ -f "$IN_VER/$vf" ]] || warn "verifier interno ausente: $vf"
  fi
done
[[ -x "$DIST_VER/verify-enterprise-governance.sh" ]] || fail "verify-enterprise-governance.sh externo não executável"
[[ -x "$DIST_VER/verify-enterprise-governance-v2.sh" ]] || fail "verify-enterprise-governance-v2.sh externo não executável"

step "7. Validar verify-result (contrato estrutural, se presente)"
if [[ -f "$DIST_VER/verify-result.json" ]]; then
  VR_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_VER/verify-result.json','utf8')); process.stdout.write(String(j && j.governedArtifactType==='payload' && typeof j.status==='string' && typeof j.payloadValidated==='boolean' && typeof j.envelopeValidated==='boolean'));" 2>/dev/null || echo false)"
  [[ "$VR_OK" == "true" ]] && ok "verify-result dentro do contrato estrutural" || fail "verify-result inválido"
else
  warn "verify-result.json ausente — não é evidência por si só (autogratificação)"
fi

step "8. Validar self-proving/package-validation/package-integrity"
if [[ -f "$DIST_GOV/self-proving-report.json" ]]; then
  # Contrato do self-proving REAL (engine self-proving-report.js): pass,
  # verifierPassed, integridade de pacote, zero referências stale.
  SP_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/self-proving-report.json','utf8')); process.stdout.write(String(j.pass===true&&j.verifierPassed===true&&j.selfProofStatus==='PASS'&&j.packageValidationOk===true&&j.packageIntegrityPass===true&&j.staleReferencesFound===0));" 2>/dev/null || echo false)"
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
if run_with_timeout "$VALIDATOR_TIMEOUT_SECONDS" bash "$VERIFY_SCRIPT" "${VERIFY_ARGS[@]}" >/tmp/audit-v2.log 2>&1; then
  ok "verify-enterprise-governance-v2 PASS"
else
  rc=$?
  if [[ "$rc" -eq 124 || "$rc" -eq 137 ]]; then
    fail "verify-enterprise-governance-v2 TIMEOUT"
  else
    fail "verify-enterprise-governance-v2 FAIL"
  fi
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
