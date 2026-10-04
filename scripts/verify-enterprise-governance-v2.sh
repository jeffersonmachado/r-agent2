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
VALIDATOR_TIMEOUT_SECONDS="${VALIDATOR_TIMEOUT_SECONDS:-45}"

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
  run_with_timeout 5 find /tmp -maxdepth 1 -type d -name 'r-agent2-audit-*' -mmin +60 -exec rm -rf {} + >/dev/null 2>&1 || true
  run_with_timeout 5 find /tmp -maxdepth 1 -type d -name 'r-agent2-final-audit-*' -mmin +60 -exec rm -rf {} + >/dev/null 2>&1 || true
}

contains_forbidden_tokens() {
  local file="$1"
  # NO_GO/PENDING exigem fronteiras não-identifier: valores de decisão reais
  # ("decision":"NO_GO") continuam bloqueando, mas rótulos legítimos como
  # "go_no_go" (chave de termo) ou "DELIVERED_PENDING_SCORECARD" (estado
  # deferido transitório) não são contaminação.
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
            fail "Referência stale detectada: $hash"
            found=true
          fi
        done < <(run_with_timeout 5 find "$target" -maxdepth 1 -type f \( -name '*.json' -o -name '*.sig' \) -print 2>/dev/null || true)
      elif run_with_timeout 5 grep -In "$hash" "$target" >> "$log_path" 2>/dev/null; then
        fail "Referência stale detectada: $hash"
        found=true
      fi
    done
  done
  [[ "$found" == false ]] && rm -f "$log_path"
}

# Padrao de referencia a um timestamp BANIDO: exige FRONTEIRA DE DIGITO.
#
# Os timestamps banidos identificam LIBERACOES/PACOTES anteriores (HHMMSS). Casar
# a sequencia crua produz falso positivo quando ela aparece DENTRO de outro
# numero — medido 2026-10-04: o run governado
# `rap-governed-20261004112450088-07de12e3` contem `124500` (dentro de
# `112450088`) e o envelope LEGITIMO foi reprovado com 12 ocorrencias de
# "Referência antiga detectada: 124500", bloqueando o passe `final` do
# release:seal (`CHECK-DIST-CLEAN: FAIL`). Referencia REAL continua detectada:
# `r-agent2-20261003-124500.manifest.json` casa porque `124500` esta delimitado
# por `-` e `.`.
#
# NAO afrouxa o gate: um identificador embutido em sequencia maior nao e
# referencia a outro artefato.
banned_timestamp_pattern() {
  printf '(^|[^0-9])%s([^0-9]|$)' "$1"
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
          if run_with_timeout 5 grep -InE "$(banned_timestamp_pattern "$ts")" "$file" >> "$log_path" 2>/dev/null; then
            fail "Referência antiga detectada: $ts"
            found=true
          fi
        done < <(run_with_timeout 5 find "$target" -maxdepth 1 -type f \( -name '*.json' -o -name '*.sig' \) -print 2>/dev/null || true)
      elif run_with_timeout 5 grep -InE "$(banned_timestamp_pattern "$ts")" "$target" >> "$log_path" 2>/dev/null; then
        fail "Referência antiga detectada: $ts"
        found=true
      fi
    done
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
cleanup_stale_tmp_dirs
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
  release_envelope_validate_zip "$ENVELOPE_PATH" || fail "Envelope contém entradas inesperadas"
  ENVELOPE_LIST="$(run_with_timeout "$VALIDATOR_TIMEOUT_SECONDS" unzip -l "$ENVELOPE_PATH" 2>/dev/null || true)"
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
  SIG_NAME="$(basename "$sig")"
  if [[ "$SIG_NAME" == "release-attestation.sig" ]]; then
    # Attestation Ed25519: verificada criptograficamente no passo 7.5 pelo
    # verify-payload-governance.js (chave pública disponível no verifier).
    continue
  fi
  # Sigs Model A (sign-governance): HMAC-SHA256 real com chave fora do pacote.
  # Offline não é possível recomputar o HMAC (por design — a chave não viaja);
  # valida-se a estrutura e a autenticidade é ancorada no attestation Ed25519.
  SIG_CHECK="$(node -e "
    const fs=require('fs');
    const p=process.argv[1];
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    const ok=(j && j.signatureVersion===2 && j.algorithm==='hmac-sha256' && typeof j.seal==='string' && j.seal.length===64 && typeof j.gitCommit==='string' && /^[0-9a-f]{40}$/.test(j.gitCommit));
    process.stdout.write(String(ok));
  " "$sig" 2>/dev/null || echo false)"
  [[ "$SIG_CHECK" == "true" ]] || fail "Signature externa inválida: $SIG_NAME (esperado HMAC-SHA256 signatureVersion=2)"
done
[[ -f "$DIST_SIG/release-attestation.sig" ]] || fail "release-attestation.sig (Ed25519) ausente em dist/signatures"

step "5. Validando estrutura interna do payload (modelo mínimo envelope-governed)"
TMP="$(mktemp -d -t r-agent2-audit-XXXXXX)"
trap cleanup_tmp EXIT
if release_payload_validate_zip "$PAYLOAD_PATH" "$PAYLOAD_NAME"; then
  ok "Payload sem arquivos proibidos"
else
  fail "Payload contaminado por arquivo proibido"
fi
if release_payload_extract_zip "$PAYLOAD_PATH" "$TMP/payload" 2>/dev/null; then
  ok "Payload extraído para validação interna"
else
  fail "Falha/timeout ao extrair payload para validação interna"
fi

IN_GOV_DIR="$TMP/payload/r-agent2/dist/governance"
IN_SIG_DIR="$TMP/payload/r-agent2/dist/signatures"
if [[ -d "$IN_GOV_DIR" ]]; then
  warn "Payload contém dist/governance interno redundante (a fonte canônica é r-agent2/governance — validada no passo 7.5)"
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
for vf in verify-enterprise-governance.sh verify-enterprise-governance-v2.sh verify-payload-governance.js release-attestation-public-key.json; do
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
# verify-result.json é ESCRITO por esta própria execução ao final — não é
# evidência (autogratificação). Se existir de uma execução anterior, valida-se
# apenas o contrato estrutural; a prova real são os gates desta execução.
if [[ -f "$DIST_VER/verify-result.json" ]]; then
  VR_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_VER/verify-result.json','utf8')); const ok=(j && j.governedArtifactType==='payload' && typeof j.status==='string' && typeof j.payloadValidated==='boolean' && typeof j.envelopeValidated==='boolean'); process.stdout.write(String(ok));" 2>/dev/null || echo false)"
  [[ "$VR_OK" == "true" ]] || fail "verify-result.json fora do contrato estrutural"
else
  warn "verify-result.json ausente — será escrito por esta execução (não é evidência por si só)"
fi

if [[ -f "$DIST_GOV/self-proving-report.json" ]]; then
  # Contrato do self-proving REAL (engine self-proving-report.js): pass,
  # verifierPassed, integridade de pacote, zero referências stale.
  SP_OK="$(node -e "const j=JSON.parse(require('fs').readFileSync('$DIST_GOV/self-proving-report.json','utf8')); const ok=(j.pass===true&&j.verifierPassed===true&&j.selfProofStatus==='PASS'&&j.packageValidationOk===true&&j.packageIntegrityPass===true&&j.staleReferencesFound===0); process.stdout.write(String(ok));" 2>/dev/null || echo false)"
  [[ "$SP_OK" == "true" ]] || fail "self-proving-report.json não é PASS real (engine)"
else
  fail "self-proving-report.json ausente"
fi

step "7.5. Governança canônica DO PAYLOAD (fail-closed, fonte da verdade)"
# Abre o payload e exige: decisão canônica GO, mesmo run/fingerprint que o
# manifest, envelope derivado idêntico à canônica, scorecard 78/78, package
# reports reais PASS e attestation Ed25519 válida. NO_GO→GO é impossível aqui.
PAYLOAD_GOV_VERIFIER="$DIST_VER/verify-payload-governance.js"
[[ -f "$PAYLOAD_GOV_VERIFIER" ]] || PAYLOAD_GOV_VERIFIER="$SCRIPT_DIR/verify-payload-governance.js"
[[ -f "$PAYLOAD_GOV_VERIFIER" ]] || fail "verify-payload-governance.js não encontrado"
if node "$PAYLOAD_GOV_VERIFIER" --payload "$PAYLOAD_PATH" --manifest "$MANIFEST_PATH" \
    --envelope-governance "$DIST_GOV" --signatures "$DIST_SIG" --verifier "$DIST_VER"; then
  ok "Governança canônica do payload verificada (PAYLOAD_GOVERNANCE_VERIFIED)"
else
  fail "Governança canônica do payload NO_GO — verificação reprovada"
fi

step "7.6. Certificação OFFLINE do selo V2 e do ciclo autônomo de bug (fail-closed)"
# O pacote governado precisa carregar a CERTIFICAÇÃO dos eixos que o autorizaram — verificável SEM
# rede, sem banco e sem o repositório. DEFEITO MEDIDO (2026-09-30): o envelope saía com 11 relatórios
# e NENHUM do selo V2/ciclo de bug; a verificação offline do V2 não tinha o que verificar.
CERT_MISSING=0
for req in engineering-router-v2-seal-execution.json engineering-router-v2-seal-decision.json bug-autonomous-loop-report.json v2-seal-freshness-report.json; do
  [[ -f "$DIST_GOV/$req" ]] || { fail "certification bundle: falta $req no envelope governado"; CERT_MISSING=1; }
done
if [[ "$CERT_MISSING" == "0" ]]; then
  CERT_OK="$(node -e "
    const fs=require('fs');
    const read=(n)=>JSON.parse(fs.readFileSync('$DIST_GOV/'+n,'utf8'));
    const problems=[];
    try {
      const seal=read('engineering-router-v2-seal-execution.json');
      const decision=read('engineering-router-v2-seal-decision.json');
      const bugLoop=read('bug-autonomous-loop-report.json');
      const freshness=read('v2-seal-freshness-report.json');
      if(seal.status!=='GO') problems.push('SEAL_NOT_GO');
      if(!seal.sourceFingerprint) problems.push('SEAL_NO_SOURCE_BINDING');
      if(decision.status!=='GO') problems.push('SEAL_DECISION_NOT_GO');
      if(bugLoop.status!=='GREEN') problems.push('BUG_LOOP_NOT_GREEN');
      if(bugLoop.verdicts && bugLoop.verdicts.BUG_AUTONOMOUS_LOOP!=='GREEN') problems.push('BUG_AUTONOMOUS_LOOP_NO_GO');
      if(freshness.status!=='PASS') problems.push('SEAL_NOT_FRESH');
    } catch (error) { problems.push('CERTIFICATION_UNREADABLE:'+error.message); }
    process.stdout.write(problems.length===0 ? 'OK' : problems.join(','));
  " 2>/dev/null || echo 'CERTIFICATION_UNREADABLE')"
  [[ "$CERT_OK" == "OK" ]] || fail "certification bundle não-verde: $CERT_OK"
  [[ "$CERT_OK" == "OK" ]] && ok "selo V2 GO com binding de source, ciclo autônomo GREEN e frescor PASS (offline)"
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
