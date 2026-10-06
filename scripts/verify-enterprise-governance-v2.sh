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

# ── 9. INTEGRIDADE TEMPORAL DA EVIDÊNCIA (offline, fail-closed) ─────────────
#
# DEFEITO REAL (medido 2026-10-05, no envelope r-agent2-20261005-011259):
# `governance/mutable-json-state-validation-report.json` (generatedAt 01:20:06) e
# `governance/json-persistence-audit.json` (01:20:05) viajaram no payload com o
# runId/sourceFingerprint do run criado às 02:30 — evidência PRÉ-RUN sustentando
# decisão do run. Hash, assinatura, runId e fingerprint batiam: nada disso detecta
# isso. Só o TEMPO detecta.
#
# A autoridade de classificação e a regra vivem na taxonomia EMPACOTADA
# (config/runtime-evidence-artifacts.json: `sameRunRule`), para que o verificador
# valide o MESMO critério do pipeline — não uma cópia própria.
step "9. Integridade temporal da evidência (generatedAt >= run.startedAt)"
TEMPORAL_PAYLOAD_ROOT="$TMP/payload/r-agent2"
if [[ ! -d "$TEMPORAL_PAYLOAD_ROOT" ]]; then
  fail "payload extraído sem raiz r-agent2 — não há como validar integridade temporal"
fi
TEMPORAL_OUT="$(node -e "
const fs=require('fs'),path=require('path');
const root=process.argv[1];
// LISTA CANÔNICA MÍNIMA EMBUTIDA NO VERIFICADOR. Não pode vir só da taxonomia do
// payload: um payload construído com taxonomia TRUNCADA escaparia da checagem
// (foi o que aconteceu no primeiro teste desta seção: a taxonomia empacotada era
// a 1.0.0, não listava o par do RAP-078, e a violação real passou).
const MINIMUM=[
  'governance/mutable-json-state-validation-report.json',
  'governance/json-persistence-audit.json',
  'governance/final-governance-report.json',
  'governance/final-consistency-report.json',
  'governance/final-proof-report.json',
  'governance/final-readiness-report.json',
  'governance/self-proving-report.json',
  'governance/tamper-detection-report.json',
  'governance/package-integrity-report.json',
  'governance/package-validation-report.json',
  'governance/evidence-manifest.json',
  'governance/certification-snapshot.json',
  'reports/master-scorecard-test-report.json',
  'reports/master-scorecard-regression-report.json',
];
const AUTHORITATIVE=['RUNTIME_EVIDENCE','DERIVED_REPORT','CERTIFICATION_ARTIFACT'];
const taxPath=path.join(root,'config','runtime-evidence-artifacts.json');
const declared=[];
if(fs.existsSync(taxPath)){
  try{const tax=JSON.parse(fs.readFileSync(taxPath,'utf8'));
    for(const mode of AUTHORITATIVE){const entry=(tax.modes||{})[mode]||{};for(const a of entry.artifacts||[]) declared.push(a);}
  }catch(_){}
}else{
  // Taxonomia ausente no payload não pode virar passe silencioso.
  process.stdout.write('TEMPORAL_TAXONOMY_MISSING');process.exit(0);
}
// Caminhos de evidência declarados pelo PRÓPRIO scorecard empacotado (regex, sem
// executar código do payload).
const scorePaths=[];
const regPath=path.join(root,'governance','master-scorecard-registry.js');
if(fs.existsSync(regPath)){
  const txt=fs.readFileSync(regPath,'utf8');const re=/path:\s*'([^']+)'/g;let m;
  while((m=re.exec(txt))!==null)scorePaths.push(m[1]);
}
const manifestPath=path.join(root,'governance','evidence-manifest.json');
let runId=null,runStartedAt=null;
if(fs.existsSync(manifestPath)){try{const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));runId=m.runId||null;runStartedAt=m.runStartedAt||null;}catch(_){}}
// Fallback tamper-evidente: o runId carrega o instante de criação do run
// (rap-governed-YYYYMMDDHHMMSSmmm-<hash>).
if(!runStartedAt&&runId){const m=/^rap-governed-(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{3})/.exec(runId);if(m){runStartedAt=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6],+m[7])).toISOString();}}
if(!runStartedAt){process.stdout.write('TEMPORAL_RUN_START_UNKNOWN');process.exit(0);}
const startedMs=Date.parse(runStartedAt);
// Artefatos canônicos que PRECISAM ser verificáveis no artefato entregue.
// Ausência aqui era silenciada pelo 'continue' abaixo — o mesmo padrão que
// deixava o scorecard referenciar 41 evidências sem prova e ainda passar.
//
// ATENÇÃO (defeito medido 2026-10-06): este bloco vive dentro de node -e com
// string entre aspas duplas. NUNCA usar crase em comentário aqui: dentro da
// substituição de comando o bash ainda trata crase como substituição, executa o
// texto como comando (erro 'continue: significativo apenas em um loop') e MUTA o
// código JS antes de o node recebê-lo. Foi exatamente o que aconteceu nesta linha.
const mandatory=new Set([...MINIMUM]);
// Cobertura alternativa para o que o PACOTE não carrega por decisão de projeto:
// generate-zip.sh exclui '/reports/' da raiz desde 2026-08-22 (é saída gerada).
// Exigir presença FÍSICA dos dois relatórios de reports/ era condição impossível
// (medido: 0 entradas reports/ no ZIP entregue). Isto NÃO afrouxa: o artefato tem
// de estar no payload OU coberto pelo proof set da seção 10 — que exige hash,
// classificação autoritativa, temporalidade SAME_RUN e veredito aceito.
const proofCovered=new Set(((()=>{
  try{
    const ps=JSON.parse(fs.readFileSync(manifestPath,'utf8')).scorecardEvidence;
    return ((ps&&ps.records)||[]).map((r)=>r.path);
  }catch(_){return [];}
})()));
const targets=[...new Set([...MINIMUM,...declared,...scorePaths])];
const violations=[];let scanned=0;
for(const rel of targets){
  const abs=path.join(root,rel);
  if(!fs.existsSync(abs)){
    if(mandatory.has(rel)&&!proofCovered.has(rel))violations.push('TEMPORAL_EVIDENCE_MISSING:'+rel);
    continue;
  }
  // DEFEITO MEDIDO (2026-10-06, ataque adversarial): artefato PRESENTE e ILEGÍVEL
  // era silenciosamente pulado por um catch cego — o mesmo padrão de skip
  // silencioso que esta seção existe para eliminar. Um byte trocado num relatório
  // declarado deixava a seção dizer OK:32 (contava um a menos) sem reprovar.
  let a;
  try{a=JSON.parse(fs.readFileSync(abs,'utf8'));}
  catch(_){violations.push('TEMPORAL_ARTIFACT_UNREADABLE:'+rel);continue;}
  if(!a||typeof a!=='object'){violations.push('TEMPORAL_ARTIFACT_NOT_OBJECT:'+rel);continue;}
  scanned++;
  const gen=a.generatedAt?Date.parse(a.generatedAt):NaN;
  if(!Number.isFinite(gen)){violations.push('TEMPORAL_GENERATED_AT_MISSING:'+rel);continue;}
  if(gen<startedMs)violations.push('TEMPORAL_LINEAGE_VIOLATION:'+rel+'(generatedAt='+a.generatedAt+'<runStartedAt='+runStartedAt+')');
}
process.stdout.write(violations.length===0?('OK:'+scanned+' artefatos autoritativos no run'):violations.slice(0,10).join(' | '));
" "$TEMPORAL_PAYLOAD_ROOT" 2>/dev/null || echo 'TEMPORAL_CHECK_UNREADABLE')"
if [[ "$TEMPORAL_OUT" == OK:* ]]; then
  ok "evidência autoritativa com integridade temporal: ${TEMPORAL_OUT#OK:}"
else
  fail "integridade temporal da evidência reprovada — $TEMPORAL_OUT"
fi

#
# Seção 10 — A NOTA DO SCORECARD PRECISA SER CONFERÍVEL, NÃO ACREDITADA.
#
# DEFEITO MEDIDO (2026-10-05) no artefato entregue: o Master Scorecard referenci 44
# evidências únicas; 3 tinham registro no evidence-manifest e 41 não tinham NENHUMA
# prova. `78/78` era, para quem recebia o pacote, um número a ser acreditado — e a
# seção 9, ao não encontrar o arquivo, executava `if (!exists) continue`.
#
# Aqui se exige o PROOF SET (`evidence-manifest.scorecardEvidence`) com, para cada
# evidência declarada pelo scorecard EMPACOTADO: hash, classificação autoritativa,
# validade temporal same-run, veredito aceito — e binding contra os BYTES reais
# quando o artefato está no payload. Faltando prova ⇒ FAIL (nunca `continue`).
#
step "10. Evidência do Master Scorecard verificável offline (proof records)"
SCORECARD_EVIDENCE_OUT="$(node -e "
const fs=require('fs'),path=require('path');
const root=process.argv[1];
const manifestPath=path.join(root,'governance','evidence-manifest.json');
if(!fs.existsSync(manifestPath)){process.stdout.write('SCORECARD_EVIDENCE_MANIFEST_MISSING');process.exit(0);}
let manifest;try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch(_){process.stdout.write('SCORECARD_EVIDENCE_MANIFEST_UNREADABLE');process.exit(0);}
const proof=manifest.scorecardEvidence;
if(!proof||typeof proof!=='object'){process.stdout.write('SCORECARD_EVIDENCE_PROOF_MISSING');process.exit(0);}
const records=Array.isArray(proof.records)?proof.records:[];
if(records.length===0){process.stdout.write('SCORECARD_EVIDENCE_PROOF_EMPTY');process.exit(0);}
// AUTORIDADE ÚNICA: o MESMO módulo que materializou o proof set vem empacotado e
// é consultado aqui. Julgar com código reimplementado criava duas autoridades que
// divergem (exatamente o defeito que a biblioteca existe para impedir).
const libPath=path.join(root,'scripts','governance','lib','scorecard-evidence-proof.js');
let lib=null;try{lib=require(libPath);}catch(_){lib=null;}
if(!lib){process.stdout.write('SCORECARD_EVIDENCE_BINDING_AUTHORITY_MISSING:'+libPath);process.exit(0);}
const violations=[];
// (1) Julgamento canônico: exists, sha256, classificação autoritativa, validade
// temporal same-run, veredito aceito e bindingKind legítimo.
const verdict=lib.assessScorecardEvidenceProof(proof);
for(const v of verdict.violations)violations.push(v.code+':'+v.path);
// (2) O scorecard EMPACOTADO é a lista do que precisa de prova: um proof set que
// omitisse uma evidência declarada passaria como 'completo'. Lista derivada da
// MESMA autoridade (registry canônico), nunca de regex sobre o arquivo.
let declaredPaths=[];
try{declaredPaths=[...new Set(lib.listScorecardEvidence().map(e=>e.path))];}catch(_){declaredPaths=[];}
if(declaredPaths.length===0){violations.push('SCORECARD_EVIDENCE_DECLARATIONS_UNREADABLE');}
const proven=new Set(records.map(r=>r.path));
for(const rel of declaredPaths)if(!proven.has(rel))violations.push('SCORECARD_EVIDENCE_UNPROVEN:'+rel);
// (3) Coerência com o manifest empacotado.
const runStartedAt=proof.runStartedAt||null;
const startedMs=runStartedAt?Date.parse(runStartedAt):NaN;
if(!Number.isFinite(startedMs))violations.push('SCORECARD_EVIDENCE_RUN_START_UNKNOWN');
if(proof.runId&&manifest.runId&&proof.runId!==manifest.runId)violations.push('SCORECARD_EVIDENCE_RUN_MISMATCH');
if(proof.sourceFingerprint&&manifest.sourceFingerprint&&proof.sourceFingerprint!==manifest.sourceFingerprint)violations.push('SCORECARD_EVIDENCE_SOURCE_MISMATCH');
// (4) Taxonomia EMPACOTADA (a classificação declarada tem de estar na allowlist).
const taxPath=path.join(root,'config','runtime-evidence-artifacts.json');
if(!fs.existsSync(taxPath)){violations.push('SCORECARD_EVIDENCE_TAXONOMY_MISSING');}
else{
  const tax=JSON.parse(fs.readFileSync(taxPath,'utf8'));
  const AUTHORITATIVE=['RUNTIME_EVIDENCE','DERIVED_REPORT','CERTIFICATION_ARTIFACT'];
  const declaredModes={};
  for(const mode of AUTHORITATIVE)for(const a of ((tax.modes||{})[mode]||{}).artifacts||[])declaredModes[a]=mode;
  for(const r of records)if(!declaredModes[r.path])violations.push('SCORECARD_EVIDENCE_NOT_AUTHORITATIVE:'+r.path+'('+String(r.classification)+')');
}
// (5) BINDING CRIPTOGRÁFICO pela autoridade única: bytes do arquivo quando ele
// está no payload; para o artefato PORTADOR (o próprio manifest), a projeção
// auto-excludente — hash de si mesmo é impossível por construção.
for(const r of records){
  const abs=path.join(root,r.path);
  if(!fs.existsSync(abs)||!r.sha256)continue;
  const binding=lib.evidenceBinding({rootDir:root,relPath:r.path,manifestForCarrier:manifest});
  if(!binding||!binding.sha256){violations.push('SCORECARD_EVIDENCE_BINDING_UNRESOLVED:'+r.path);continue;}
  if(binding.sha256!==r.sha256)violations.push('SCORECARD_EVIDENCE_HASH_MISMATCH:'+r.path);
}
process.stdout.write(violations.length===0?('OK:'+records.length+' provas/('+declaredPaths.length+' declaradas)'):violations.slice(0,8).join(' | '));
" "$TEMPORAL_PAYLOAD_ROOT" 2>/dev/null || echo 'SCORECARD_EVIDENCE_CHECK_UNREADABLE')"
if [[ "$SCORECARD_EVIDENCE_OUT" == OK:* ]]; then
  ok "nota do scorecard conferível offline: ${SCORECARD_EVIDENCE_OUT#OK:}"
else
  fail "prova das evidências do Master Scorecard reprovada — $SCORECARD_EVIDENCE_OUT"
fi

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
