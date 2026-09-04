#!/usr/bin/env bash
# =============================================================================
# check-dist-clean.sh — Valida dist/ no modelo rígido ENVELOPE + PAYLOAD
#
# Exit: 0 = PASS | 1 = FAIL
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/../release" && -d "$SCRIPT_DIR/../governance" && -d "$SCRIPT_DIR/../signatures" ]]; then
  DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  PROJECT_ROOT="$(cd "$DIST_DIR/.." && pwd)"
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  DIST_DIR="$PROJECT_ROOT/dist"
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

PASS=true
FAILURES=()
CHECKS_OK=()

ok()   { [[ "$JSON_MODE" == false ]] && echo -e "${GREEN}  ✓ $*${NC}" || true; CHECKS_OK+=("$1"); }
fail() { [[ "$JSON_MODE" == false ]] && echo -e "${RED}  ✗ $*${NC}" || true; PASS=false; FAILURES+=("$*"); }
warn() { [[ "$JSON_MODE" == false ]] && echo -e "${YELLOW}  ⚠ $*${NC}" || true; }
step() { [[ "$JSON_MODE" == false ]] && echo -e "${BLUE}[check-dist-clean] $*${NC}" || true; }

cd "$PROJECT_ROOT"

step "1. Verificando estrutura de diretórios obrigatórios..."
for d in release governance signatures verifier; do
  if [[ -d "$DIST_DIR/$d" ]]; then
    ok "dist/$d/ existe"
  else
    fail "dist/$d/ AUSENTE"
  fi
done

step "2. Localizando PAYLOAD, MANIFEST e ENVELOPE..."
PAYLOAD_PATH="$(ls -t "$DIST_DIR/release"/*.payload.zip 2>/dev/null | head -1 || true)"
ENVELOPE_PATH="$(ls -t "$DIST_DIR/release"/*.zip 2>/dev/null | grep -v '.payload.zip' | head -1 || true)"

if [[ -z "$PAYLOAD_PATH" || ! -f "$PAYLOAD_PATH" ]]; then
  fail "Nenhum PAYLOAD encontrado em dist/release/*.payload.zip"
fi
if [[ -z "$ENVELOPE_PATH" || ! -f "$ENVELOPE_PATH" ]]; then
  ENVELOPE_AVAILABLE=false
  ok "envelope externo não embutido; dist/ será validado como envelope descompactado"
else
  ENVELOPE_AVAILABLE=true
fi

if [[ -n "$PAYLOAD_PATH" && -f "$PAYLOAD_PATH" ]]; then
  PAYLOAD_NAME="$(basename "$PAYLOAD_PATH")"
  MANIFEST_NAME="${PAYLOAD_NAME%.payload.zip}.manifest.json"
  MANIFEST_PATH="$DIST_DIR/release/$MANIFEST_NAME"
  [[ -f "$MANIFEST_PATH" ]] && ok "dist/release/$MANIFEST_NAME" || fail "dist/release/$MANIFEST_NAME AUSENTE"
fi

step "3. Validando manifest payload-centric..."
if [[ -f "${MANIFEST_PATH:-}" && -f "${PAYLOAD_PATH:-}" ]]; then
  PAYLOAD_SHA="$(sha256sum "$PAYLOAD_PATH" | awk '{print $1}')"
  MANIFEST_SHA="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')); process.stdout.write(m.sha256||'');" 2>/dev/null || echo '')"
  ARTIFACT="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')); process.stdout.write(m.artifact||'');" 2>/dev/null || echo '')"
  GOV_ARTIFACT="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')); process.stdout.write(m.governedArtifact||'');" 2>/dev/null || echo '')"
  TYPE="$(node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')); process.stdout.write(m.artifactType||'');" 2>/dev/null || echo '')"

  [[ "$MANIFEST_SHA" == "$PAYLOAD_SHA" ]] && ok "sha256 do payload confere no manifest" || fail "manifest.sha256 difere do payload"
  [[ "$ARTIFACT" == "$PAYLOAD_NAME" ]] && ok "manifest.artifact correto" || fail "manifest.artifact inválido"
  [[ "$GOV_ARTIFACT" == "$PAYLOAD_NAME" ]] && ok "manifest.governedArtifact correto" || fail "manifest.governedArtifact inválido"
  [[ "$TYPE" == "payload" ]] && ok "manifest.artifactType=payload" || fail "manifest.artifactType inválido"
fi

step "4. Verificando arquivos obrigatórios de governança/signatures/verifier..."
for f in \
  self-proving-report.json \
  package-validation-report.json \
  package-integrity-report.json \
  governance-attestation.json \
  governance-chain.json \
  final-governance-report.json

do
  [[ -f "$DIST_DIR/governance/$f" ]] && ok "dist/governance/$f" || fail "dist/governance/$f AUSENTE"
done

for f in package.manifest.sig governance.sig release.sig replay.sig release-attestation.sig; do
  [[ -f "$DIST_DIR/signatures/$f" ]] && ok "dist/signatures/$f" || fail "dist/signatures/$f AUSENTE"
done

[[ -f "$DIST_DIR/verifier/verify-enterprise-governance.sh" ]] && ok "dist/verifier/verify-enterprise-governance.sh" || fail "dist/verifier/verify-enterprise-governance.sh AUSENTE"
[[ -f "$DIST_DIR/verifier/verify-enterprise-governance-v2.sh" ]] && ok "dist/verifier/verify-enterprise-governance-v2.sh" || fail "dist/verifier/verify-enterprise-governance-v2.sh AUSENTE"
[[ -f "$DIST_DIR/verifier/verify-payload-governance.js" ]] && ok "dist/verifier/verify-payload-governance.js" || fail "dist/verifier/verify-payload-governance.js AUSENTE"
[[ -f "$DIST_DIR/verifier/release-attestation-public-key.json" ]] && ok "dist/verifier/release-attestation-public-key.json" || fail "dist/verifier/release-attestation-public-key.json AUSENTE"
# verify-result.json é o recibo que o verifier escreve QUANDO executado (passo
# 6). Ele NUNCA é empacotado no envelope. Aqui ele só é aceitável se estiver
# vinculado ao payload ATUAL — um recibo de release anterior é evidência stale
# (STALE_VERIFIER_RESULT) e invalida a higiene do dist/.
if [[ -f "$DIST_DIR/verifier/verify-result.json" ]]; then
  if [[ -z "${PAYLOAD_NAME:-}" ]]; then
    fail "STALE_VERIFIER_RESULT — verify-result.json presente sem payload atual identificável"
  else
  VR_MATCH="$(node -e "
    try {
      const fs=require('fs');
      const vr=JSON.parse(fs.readFileSync('$DIST_DIR/verifier/verify-result.json','utf8'));
      const want='$PAYLOAD_NAME';
      const bound = String(vr.payload||vr.payloadName||vr.artifact||'');
      const rel   = String(vr.releaseId||vr.release||'');
      const cur   = want.replace(/\.payload\.zip$/,'');
      process.stdout.write((bound===want || rel===cur || (cur.length>0 && bound.includes(cur))) ? 'yes' : 'no');
    } catch(_) { process.stdout.write('no'); }
  " 2>/dev/null || echo 'no')"
  if [[ "$VR_MATCH" == "yes" ]]; then
    ok "dist/verifier/verify-result.json (recibo do payload atual — gerado pelo passo 6, não empacotado)"
  else
    fail "STALE_VERIFIER_RESULT — dist/verifier/verify-result.json não está vinculado ao payload atual ($PAYLOAD_NAME)"
  fi
  fi
else
  ok "dist/verifier/ sem verify-result.json pré-empacotado (será escrito pelo passo 6)"
fi

step "5. Verificando dist/ raiz sem artefatos inesperados..."
# Regra canônica (AGENTS.md): "dist/ deve permanecer limpo, EXCETO ZIPs e
# manifestos de release aprovados". O caminho oficial `npm run zip:release`
# (scripts/release-package.sh) escreve o ZIP auditado + manifesto sidecar em
# dist/ por design — são artefatos aprovados, não sujeira. O fluxo de envelope
# governado (two-pass-release) vive em dist/release/ e é verificado no passo 6.
UNEXPECTED="$(ls "$DIST_DIR/" 2>/dev/null | grep -Ev '^(release|governance|signatures|verifier|ci-logs)$' | grep -Ev '^r-agent2-[0-9]{8}-[0-9]{6}(-[a-z0-9-]+)?\.(zip|manifest\.json)$' || true)"
if [[ -n "$UNEXPECTED" ]]; then
  fail "Arquivos/dirs inesperados na raiz de dist/: $(echo "$UNEXPECTED" | tr '\n' ' ')"
else
  ok "dist/ raiz normalizada"
fi

step "6. Rodando verificação rígida v2..."
if [[ "${CHECK_DIST_CLEAN_DEFERRED_CANDIDATE:-0}" == "1" ]]; then
  # Fase DELIVERED: o candidato é selado com a decisão DEFERRED verdadeira
  # (PASS_WITH_DEFERRED_PACKAGE_GATE) — o verifier estrito v2 exige GO e,
  # por design, reprova o candidato. A verificação do candidato é feita pelo
  # verify:delivered-release (verifyDeferredCandidate); o release GO final
  # passa por este passo normalmente na tentativa SEAL_GO.
  ok "verify-enterprise-governance-v2.sh adiado (candidato DEFERRED — verificação via verify:delivered-release)"
else
VERIFY_SCRIPT="$PROJECT_ROOT/scripts/verify-enterprise-governance-v2.sh"
[[ -f "$DIST_DIR/verifier/verify-enterprise-governance-v2.sh" ]] && VERIFY_SCRIPT="$DIST_DIR/verifier/verify-enterprise-governance-v2.sh"
VERIFY_ARGS=(--payload "${PAYLOAD_PATH:-}")
if [[ "${ENVELOPE_AVAILABLE:-false}" == true ]]; then
  VERIFY_ARGS+=(--envelope "$ENVELOPE_PATH")
fi
if bash "$VERIFY_SCRIPT" "${VERIFY_ARGS[@]}" >/tmp/check-dist-verify.log 2>&1; then
  ok "verify-enterprise-governance-v2.sh PASS"
else
  fail "verify-enterprise-governance-v2.sh FAIL"
  warn "Resumo do verifier:"
  tail -n 25 /tmp/check-dist-verify.log | sed 's/^/    /' || true
fi
fi

echo ""
PASS_COUNT="${#CHECKS_OK[@]}"
FAIL_COUNT="${#FAILURES[@]}"

if [[ "$JSON_MODE" == true ]]; then
  FAILS_JSON="$(printf '"%s",' "${FAILURES[@]+"${FAILURES[@]}"}")"
  node -e "process.stdout.write(JSON.stringify({
    pass: ${PASS},
    checksOk: $PASS_COUNT,
    checksFailed: $FAIL_COUNT,
    failures: [${FAILS_JSON%,}].filter(Boolean)
  },null,2)+'\\n');" 2>/dev/null || true
else
  if [[ "$PASS" == true ]]; then
    echo -e "${GREEN}${BOLD}  CHECK-DIST-CLEAN: PASS${NC}"
    echo -e "${GREEN}  dist/ normalizado — ${PASS_COUNT} checks OK${NC}"
  else
    echo -e "${RED}${BOLD}  CHECK-DIST-CLEAN: FAIL${NC}"
    for f in "${FAILURES[@]+"${FAILURES[@]}"}"; do
      [[ -n "$f" ]] && echo -e "${RED}    ✗ $f${NC}"
    done
  fi
fi

[[ "$PASS" == true ]] && exit 0 || exit 1
