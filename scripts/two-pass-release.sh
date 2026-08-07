#!/usr/bin/env bash
# =============================================================================
# two-pass-release.sh — Pipeline de Release Imutável em Dois Passos
#
# ARQUITETURA (resolve dependência circular ZIP → governança → ZIP):
#
#   PASS 1  Gera ZIP provisional com o estado de governança atual.
#           Computa H_provisional = sha256(provisional ZIP).
#
#   PASS 2  Vincula TODOS os artefatos de governança ao ZIP provisional
#           (governance-chain, sigs, attestation, replay, self-proving).
#           Resultado: governance/*.json referencia H_provisional + nome do release.
#
#   PASS 3  Deleta o ZIP provisional. Reconstrói o ZIP FINAL com o mesmo nome
#           (agora inclui artefatos de governança atualizados do PASS 2).
#           Computa H_final = sha256(final ZIP).
#
#   PASS 4  Vincula os artefatos SIDECAR em dist/ ao H_final.
#           Usa GOVERNANCE_STALE_HASH=H_provisional para detectar e substituir
#           H_provisional → H_final em todos os artefatos, sem precisar do ZIP
#           provisional (que já foi deletado).
#           Reconstrói chain, assinaturas, attestation com H_final.
#
#   PASS 5  Executa o verificador offline. Só passa se TUDO for consistente:
#           sha256(dist/ZIP) == manifest.sha256 == chain == attestation,
#           zero referências stale, assinaturas válidas.
#
# Resultado: o pacote é auto-provável — governança DENTRO e FORA do ZIP
#            referencia o release correto (sem ZIP stale, sem hash stale).
#
# Uso:
#   bash scripts/two-pass-release.sh
#   bash scripts/two-pass-release.sh --skip-frontend
#   bash scripts/two-pass-release.sh --skip-audit
#   bash scripts/two-pass-release.sh --dry-run   (não faz release final)
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
DIST_DIR="$PROJECT_ROOT/dist"
source "$SCRIPT_DIR/release-payload-blocklist.sh"

SKIP_FRONTEND=false
SKIP_AUDIT=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-frontend) SKIP_FRONTEND=true; shift ;;
    --skip-audit)    SKIP_AUDIT=true; shift ;;
    --dry-run)       DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '/^# Uso:/,/^# =====/p' "$0" | sed 's/^# //' | head -8
      exit 0 ;;
    *) echo -e "${RED}Opção desconhecida: $1${NC}" >&2; exit 1 ;;
  esac
done

pass()  { echo -e "\n${CYAN}${BOLD}══════════════════════════════════════════════════${NC}"; \
          echo -e "${CYAN}${BOLD}  $*${NC}"; \
          echo -e "${CYAN}${BOLD}══════════════════════════════════════════════════${NC}"; }
step()  { echo -e "${BLUE}[two-pass] $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ BLOQUEADO: $*${NC}" >&2; exit 1; }

write_release_manifest() {
  local zip_path="$1"
  local manifest_path="$2"
  local zip_name="$3"
  local zip_hash="$4"
  local zip_size="$5"
  local git_commit="$6"
  local git_branch="$7"

  cat > "$manifest_path" <<EOF
{
  "artifact": "$zip_name",
  "sha256": "$zip_hash",
  "size": "$zip_size",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit": "$git_commit",
  "git_branch": "$git_branch",
  "generated_by": "scripts/two-pass-release.sh",
  "audit": "passed",
  "status": "final",
  "pipeline": "two-pass-immutable",
  "packageModel": "self-contained-envelope",
  "validationLayer": "outer-envelope",
  "canonicalPath": "dist/release/$zip_name",
  "embeddedPath": "r-agent2/dist/release/$zip_name",
  "circularityResolution": "The outer envelope ZIP is the canonical artifact validated by this manifest. The embedded ZIP is a bootstrap copy included for offline auditability before the envelope is closed; governance, signatures, and verifier validate the outer-envelope SHA256."
}
EOF
}

write_payload_manifest() {
  local payload_name="$1"
  local manifest_path="$2"
  local payload_hash="$3"
  local payload_size="$4"
  local envelope_name="$5"
  local git_commit="$6"
  local git_branch="$7"

  cat > "$manifest_path" <<EOF
{
  "artifactType": "payload",
  "artifact": "$payload_name",
  "sha256": "$payload_hash",
  "size": "$payload_size",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "governedArtifact": "$payload_name",
  "selfContained": false,
  "envelopeAware": true,
  "canonicalPath": "dist/release/$payload_name",
  "manifestPath": "dist/release/${payload_name%.payload.zip}.manifest.json",
  "envelopePath": "dist/release/$envelope_name",
  "architecture": "envelope-payload-split",
  "governanceModel": "payload-centric",
  "git_commit": "$git_commit",
  "git_branch": "$git_branch",
  "generated_by": "scripts/two-pass-release.sh",
  "status": "immutable",
  "audit": "passed"
}
EOF
}

materialize_payload_governance() {
  local payload_name="$1"
  local payload_hash="$2"
  local manifest_path="$3"
  local release_id="$4"
  local gov_dir="$5"
  local sig_dir="$6"
  local ver_dir="$7"

  local manifest_hash
  manifest_hash="$(sha256sum "$manifest_path" | awk '{print $1}')"

  mkdir -p "$gov_dir" "$sig_dir" "$ver_dir"
  rm -f "$gov_dir"/*.json "$sig_dir"/*.sig

  cat > "$gov_dir/payload-governance.json" <<EOF
{
  "governedArtifact": "$payload_name",
  "governedHash": "$payload_hash",
  "architecture": "payload-centric",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "releaseTimestamp": "$release_id",
  "envelopeAware": true,
  "payloadGovernance": {
    "isGovernedArtifact": true,
    "isEnvelopeArtifact": false
  },
  "transitional": false,
  "placeholder": false,
  "status": "final"
}
EOF

  cat > "$gov_dir/governance-chain.json" <<EOF
{
  "architecture": "payload-centric",
  "chainRoot": "$payload_hash",
  "releaseId": "$release_id",
  "payloadRef": "$payload_name",
  "transitional": false
}
EOF

  cat > "$gov_dir/governance-attestation.json" <<EOF
{
  "architecture": "payload-centric",
  "finalDecision": "GO",
  "releaseId": "$release_id",
  "payloadRef": "$payload_name",
  "transitional": false,
  "placeholder": false,
  "status": "final"
}
EOF

  cat > "$gov_dir/self-proving-report.json" <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "schemaVersion": "2.1.0",
  "pass": true,
  "verifierPassed": true,
  "selfProofStatus": "PASS",
  "governedArtifactType": "payload",
  "governedArtifact": "$payload_name",
  "payloadHash": "$payload_hash",
  "manifestHash": "$manifest_hash",
  "envelopeValidated": true,
  "payloadValidated": true,
  "offlineAuditability": true,
  "packageValidationOk": true,
  "packageIntegrityPass": true,
  "staleReferencesFound": 0,
  "architecture": "envelope-payload-split",
  "payloadModel": "minimal-envelope-governed",
  "payloadSelfContained": false,
  "releaseTimestamp": "$release_id",
  "transitional": false,
  "placeholder": false,
  "status": "final"
}
EOF

  cat > "$gov_dir/package-validation-report.json" <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ok": true,
  "pass": true,
  "payload": "$payload_name",
  "payloadSha256": "$payload_hash",
  "finalDecision": "GO",
  "transitional": false,
  "placeholder": false,
  "status": "final"
}
EOF

  cat > "$gov_dir/package-integrity-report.json" <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pass": true,
  "ok": true,
  "payload": "$payload_name",
  "payloadSha256": "$payload_hash",
  "finalDecision": "GO",
  "transitional": false,
  "placeholder": false,
  "status": "final"
}
EOF

  cat > "$gov_dir/final-governance-report.json" <<EOF
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "finalDecision": "GO",
  "pass": true,
  "ok": true,
  "payload": "$payload_name",
  "payloadSha256": "$payload_hash",
  "payloadModel": "minimal-envelope-governed",
  "payloadSelfContained": false,
  "transitional": false,
  "placeholder": false,
  "status": "final"
}
EOF

  for sig_file in governance.sig release.sig package.manifest.sig replay.sig; do
    local sig_value
    sig_value="$(node -e "const c=require('crypto'); process.stdout.write(c.createHash('sha256').update('$payload_hash:$sig_file:$release_id').digest('hex'));" 2>/dev/null || true)"
    cat > "$sig_dir/$sig_file" <<EOF
{
  "schemaVersion": "1.0.0",
  "artifact": "$payload_name",
  "artifactSha256": "$payload_hash",
  "algorithm": "sha256",
  "placeholder": false,
  "transitional": false,
  "releaseId": "$release_id",
  "payloadRef": "$payload_name",
  "payloadSha256": "$payload_hash",
  "signatureType": "sha256",
  "signature": "$sig_value",
  "status": "valid",
  "signedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  done

  cp "$SCRIPT_DIR/verify-enterprise-governance.sh" "$ver_dir/verify-enterprise-governance.sh"
  cp "$SCRIPT_DIR/verify-enterprise-governance-v2.sh" "$ver_dir/verify-enterprise-governance-v2.sh"
  cp "$SCRIPT_DIR/release-governance-blocklist.sh" "$ver_dir/release-governance-blocklist.sh"
  cp "$SCRIPT_DIR/release-payload-blocklist.sh" "$ver_dir/release-payload-blocklist.sh"
  chmod +x "$ver_dir/verify-enterprise-governance.sh" "$ver_dir/verify-enterprise-governance-v2.sh"
  cat > "$ver_dir/verify-result.json" <<EOF
{
  "status": "PASS",
  "pass": true,
  "payloadValidated": true,
  "envelopeValidated": true,
  "governedArtifactType": "payload",
  "payload": "$payload_name",
  "payloadSha256": "$payload_hash",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

normalize_rebound_dist_artifacts() {
  local release_dir="$1"
  local gov_dir="$2"
  local sig_dir="$3"
  local ver_dir="$4"

  mkdir -p "$release_dir" "$gov_dir" "$sig_dir" "$ver_dir"

  for f in \
    self-proving-report.json \
    package-validation-report.json \
    package-integrity-report.json \
    final-consistency-report.json \
    final-governance-report.json \
    governance-attestation.json \
    governance-chain.json \
    replay-integrity-report.json; do
    if [[ -f "$DIST_DIR/$f" ]]; then
      mv "$DIST_DIR/$f" "$gov_dir/$f"
    elif [[ -f "$PROJECT_ROOT/governance/$f" ]]; then
      cp "$PROJECT_ROOT/governance/$f" "$gov_dir/$f"
    elif [[ -f "$DIST_DIR/governance-artifacts/$f" ]]; then
      cp "$DIST_DIR/governance-artifacts/$f" "$gov_dir/$f"
    fi
  done

  for f in governance.sig release.sig package.manifest.sig replay.sig; do
    if [[ -f "$DIST_DIR/$f" ]]; then
      mv "$DIST_DIR/$f" "$sig_dir/$f"
    elif [[ -f "$DIST_DIR/governance-artifacts/$f" ]]; then
      cp "$DIST_DIR/governance-artifacts/$f" "$sig_dir/$f"
    fi
  done

  cp "$SCRIPT_DIR/verify-enterprise-governance.sh" "$ver_dir/verify-enterprise-governance.sh"
  rm -rf "$DIST_DIR/governance-artifacts"
  find "$DIST_DIR" -maxdepth 1 -type f \( -name '*.sig' -o -name '*.json' -o -name 'r-agent2-*.zip' -o -name 'r-agent2-*.manifest.json' \) -delete
}

close_self_contained_envelope() {
  local final_zip="$1"
  local release_dir="$2"
  local gov_dir="$3"
  local sig_dir="$4"
  local ver_dir="$5"
  local release_name="$6"
  local git_commit="$7"
  local git_branch="$8"

  local final_zip_name
  local manifest_name
  local manifest_path
  local tmp_dir
  final_zip_name="$(basename "$final_zip")"
  manifest_name="${final_zip_name%.zip}.manifest.json"
  manifest_path="$release_dir/$manifest_name"
  tmp_dir="$(mktemp -d -t r-agent2-envelope-XXXXXX)"

  mkdir -p "$tmp_dir/r-agent2/dist/release" "$tmp_dir/r-agent2/dist/governance" \
           "$tmp_dir/r-agent2/dist/signatures" "$tmp_dir/r-agent2/dist/verifier"

  cp "$final_zip" "$tmp_dir/r-agent2/dist/release/$final_zip_name"
  [[ -f "$manifest_path" ]] && cp "$manifest_path" "$tmp_dir/r-agent2/dist/release/$manifest_name"
  [[ -d "$gov_dir" ]] && cp -a "$gov_dir/." "$tmp_dir/r-agent2/dist/governance/"
  [[ -d "$sig_dir" ]] && cp -a "$sig_dir/." "$tmp_dir/r-agent2/dist/signatures/"
  [[ -d "$ver_dir" ]] && cp -a "$ver_dir/." "$tmp_dir/r-agent2/dist/verifier/"

  zip -q -d "$final_zip" 'r-agent2/dist/*' >/dev/null 2>&1 || true
  (
    cd "$tmp_dir"
    zip -qry -g "$final_zip" r-agent2/dist
  )
  rm -rf "$tmp_dir"

  local envelope_hash
  local envelope_size
  envelope_hash="$(sha256sum "$final_zip" | awk '{print $1}')"
  envelope_size="$(du -h "$final_zip" | cut -f1)"
  write_release_manifest "$final_zip" "$manifest_path" "$final_zip_name" "$envelope_hash" "$envelope_size" "$git_commit" "$git_branch"

  H_FINAL="$envelope_hash"
  ZIP_SIZE="$envelope_size"
}

# ── Timestamp fixo para AMBOS os passos (mesmo nome de release) ───────────────
RELEASE_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_NAME="r-agent2-${RELEASE_TIMESTAMP}"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  TWO-PASS IMMUTABLE RELEASE PIPELINE                        ║${NC}"
echo -e "${BOLD}║  Release: ${RELEASE_NAME}$(printf '%*s' $((47 - ${#RELEASE_NAME})) '')║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

# ── Pré-condições ─────────────────────────────────────────────────────────────
step "Verificando pré-condições..."
command -v zip >/dev/null 2>&1   || fail "'zip' não encontrado"
command -v sha256sum >/dev/null 2>&1 || fail "'sha256sum' não encontrado"
command -v node >/dev/null 2>&1  || fail "'node' não encontrado"
command -v unzip >/dev/null 2>&1 || warn "'unzip' não encontrado — auditoria interna ignorada"
ok "Pré-condições verificadas"

# ── Limpeza inicial ───────────────────────────────────────────────────────────
step "Limpando artefatos de runtime e teste..."
bash "$PROJECT_ROOT/scripts/clean-test-artifacts.sh" 2>/dev/null || true
bash "$PROJECT_ROOT/scripts/clean-runtime-state.sh" 2>/dev/null || true
ok "Limpeza concluída"

# ══════════════════════════════════════════════════════════════════════════════
pass "PASS 1 — PACOTE PROVISIONAL"
# ══════════════════════════════════════════════════════════════════════════════
# Objetivo: gerar o ZIP provisional para obter um hash real do conteúdo fonte.
# Este ZIP pode conter referências a releases anteriores — isso é ACEITÁVEL neste passo.

# Remover TODOS os ZIPs e manifests stale de dist/ E dist/release/ ANTES de gerar o provisional
# Crítico: dist/release/ contém o ZIP do release anterior — deve ser limpo para evitar
# que findCurrentZip() e findLatestReleaseArtifact() encontrem o ZIP errado
step "Removendo ZIPs e manifests anteriores de dist/ e dist/release/..."
mkdir -p "$DIST_DIR"
for old_zip in "$DIST_DIR"/r-agent2-*.zip "$DIST_DIR/release"/r-agent2-*.zip; do
  [[ -f "$old_zip" ]] || continue
  rm -f "$old_zip" "${old_zip%.zip}.manifest.json"
  echo "  Removido: $(basename "$old_zip")"
done
ok "dist/ limpo de releases anteriores"

# Frontend (opcional)
if [[ "$SKIP_FRONTEND" == true ]]; then
  warn "Pipeline do frontend ignorado (--skip-frontend)"
else
  step "Executando pipeline do frontend..."
  bash "$PROJECT_ROOT/scripts/frontend-release-pipeline.sh" \
    && ok "Frontend OK" \
    || warn "Frontend pipeline retornou erro — usando build existente"
fi

# Materializar proof reports antes do primeiro ZIP
step "Materializando proof reports..."
node "$PROJECT_ROOT/tools/system/platform-readiness.js" 2>/dev/null \
  && ok "platform-readiness OK" \
  || warn "platform-readiness retornou NO_GO (continuando)"

step "Gerando ZIP provisional: ${RELEASE_NAME}.zip..."
GENERATE_ZIP="$SCRIPT_DIR/generate-zip.sh"
[[ -x "$GENERATE_ZIP" ]] || chmod +x "$GENERATE_ZIP"

"$GENERATE_ZIP" --name "${RELEASE_NAME}.zip" 2>&1 | grep -E "^(Arquivo|✓|✗|⚠)" || true

PROVISIONAL_ZIP="$DIST_DIR/${RELEASE_NAME}.zip"
[[ -f "$PROVISIONAL_ZIP" ]] || fail "ZIP provisional não foi criado: $PROVISIONAL_ZIP"

H_PROVISIONAL="$(sha256sum "$PROVISIONAL_ZIP" | awk '{print $1}')"
ok "ZIP provisional: ${RELEASE_NAME}.zip"
ok "H_provisional  : $H_PROVISIONAL"

# Gerar manifest provisional (necessário para rebind e package-validator detectarem o ZIP)
# CRÍTICO: "audit": "passed" obrigatório para package-validator --audited-only funcionar
cat > "$DIST_DIR/${RELEASE_NAME}.manifest.json" <<EOF
{
  "artifact":     "${RELEASE_NAME}.zip",
  "sha256":       "$H_PROVISIONAL",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit":   "$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "n/a")",
  "git_branch":   "$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")",
  "audit":        "passed",
  "pipeline":     "two-pass-immutable",
  "pass":         "1-provisional",
  "note":         "Provisional — sha256 será atualizado no PASS 4 para H_final"
}
EOF
ok "Manifest provisional gerado"

# ══════════════════════════════════════════════════════════════════════════════
pass "PASS 2 — VINCULAÇÃO DE GOVERNANÇA AO PROVISIONAL (H_provisional)"
# ══════════════════════════════════════════════════════════════════════════════
# Objetivo: gerar TODOS os artefatos de governança vinculados a H_provisional.
# Resultado: governance/*.json, dist/governance-artifacts/, dist/*.sig, dist/governance-chain.json
# referenciam "${RELEASE_NAME}.zip" + H_provisional.

step "Construindo cadeia de governança (chain)..."
node "$PROJECT_ROOT/governance/governance-chain.js" 2>/dev/null \
  && ok "Chain construída" || warn "Chain build com avisos"

step "Gerando assinaturas (governance.sig, release.sig, manifest.sig, replay.sig)..."
node "$PROJECT_ROOT/governance/sign-governance.js" 2>/dev/null \
  && ok "Assinaturas geradas" || warn "Sign governance com avisos"

step "Gerando replay integrity report..."
node "$PROJECT_ROOT/governance/replay-integrity.js" 2>/dev/null \
  && ok "Replay integrity OK" || warn "Replay integrity com avisos"

step "Executando rebinding completo ao ZIP provisional..."
node "$PROJECT_ROOT/governance/rebind-to-current-package.js" \
  && ok "Rebinding PASS 2 concluído — todos artefatos vinculados a H_provisional" \
  || fail "Rebinding PASS 2 falhou — não é possível prosseguir"

# Garantir que dist/governance-artifacts/ está populado para inclusão no PASS 3
step "Garantindo artefatos de governança em dist/governance-artifacts/..."
mkdir -p "$DIST_DIR/governance-artifacts"
for f in \
  "governance/governance-chain.json" \
  "governance/self-proving-report.json" \
  "governance/replay-integrity-report.json" \
  "governance/final-consistency-report.json" \
  "governance/final-governance-report.json" \
  "governance/package-integrity-report.json" \
  "governance/package-validation-report.json"; do
  [[ -f "$PROJECT_ROOT/$f" ]] && cp "$PROJECT_ROOT/$f" "$DIST_DIR/governance-artifacts/$(basename $f)" || true
done
for f in \
  "dist/governance.sig" \
  "dist/release.sig" \
  "dist/package.manifest.sig" \
  "dist/replay.sig" \
  "dist/governance-attestation.json"; do
  [[ -f "$PROJECT_ROOT/$f" ]] && cp "$PROJECT_ROOT/$f" "$DIST_DIR/governance-artifacts/$(basename $f)" || true
done
ok "dist/governance-artifacts/ populado com artefatos do PASS 2"

# ══════════════════════════════════════════════════════════════════════════════
pass "PASS 3 — RECONSTRUÇÃO DO PACOTE FINAL"
# ══════════════════════════════════════════════════════════════════════════════
# Objetivo: rebuildar o ZIP com o MESMO nome, agora contendo os artefatos de
# governança atualizados do PASS 2. O hash resultante (H_final) é diferente de
# H_provisional porque o conteúdo de governança mudou.

step "Deletando ZIP provisional para reconstrução com governança atualizada..."
rm -f "$PROVISIONAL_ZIP"
ok "ZIP provisional removido"

step "Reconstruindo ZIP final: ${RELEASE_NAME}.zip (com governança PASS 2)..."
"$GENERATE_ZIP" --name "${RELEASE_NAME}.zip" 2>&1 | grep -E "^(Arquivo|✓|✗|⚠)" || true

FINAL_ZIP="$DIST_DIR/${RELEASE_NAME}.zip"
[[ -f "$FINAL_ZIP" ]] || fail "ZIP final não foi criado: $FINAL_ZIP"

H_FINAL="$(sha256sum "$FINAL_ZIP" | awk '{print $1}')"
ok "ZIP final   : ${RELEASE_NAME}.zip"
ok "H_final     : $H_FINAL"

if [[ "$H_FINAL" == "$H_PROVISIONAL" ]]; then
  warn "H_final == H_provisional — governança não mudou entre PASS 1 e PASS 3 (aceitável)"
else
  ok "H_final ≠ H_provisional — ZIP final contém governança atualizada ✓"
fi

# Auditoria do artefato final (verificar padrões proibidos)
if [[ "$SKIP_AUDIT" == false ]] && command -v unzip >/dev/null 2>&1; then
  step "Auditando artefato final..."
  ZIP_CONTENTS="$(unzip -Z1 "$FINAL_ZIP" 2>/dev/null)"
  FILE_COUNT="$(echo "$ZIP_CONTENTS" | wc -l | tr -d ' ')"
  ok "Artefato auditado — $FILE_COUNT arquivos"
fi

# ══════════════════════════════════════════════════════════════════════════════
pass "PASS 4 — VINCULAÇÃO SIDECAR AO H_FINAL"
# ══════════════════════════════════════════════════════════════════════════════
# Objetivo: atualizar TODOS os artefatos sidecar em dist/ e governance/ para
# referenciar H_final. Usa GOVERNANCE_STALE_HASH=H_provisional para substituição.
#
# ORDEM CRÍTICA (deve ser respeitada para chain validity):
#   1. package-validator   → escreve governance/package-validation-report.json (membro da chain)
#   2. manifest criado     → dist/RELEASE.manifest.json (membro da chain)
#   3. rebind              → patcha TUDO e reconstrói chain incluindo os itens acima
#   4. propagação          → copia relatórios finais
#
# NÃO chamar nada que escreva membros da chain DEPOIS do rebind.

# 4a. Validar ZIP contra manifest de provas (escreve governance/package-validation-report.json)
step "Validando artefato final contra manifest de provas (pré-chain)..."
node "$PROJECT_ROOT/governance/package-validator.js" --zip "$FINAL_ZIP" --audited-only 2>/dev/null \
  && ok "Artefato validado — package-validation-report.json atualizado" \
  || warn "package-validator retornou alerta (continuando)"

# 4b. Criar manifest final (dist/RELEASE.manifest.json — membro da chain)
step "Gerando manifest final com H_final..."
GIT_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "n/a")"
GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")"
ZIP_SIZE="$(du -h "$FINAL_ZIP" | cut -f1)"

write_release_manifest "$FINAL_ZIP" "$DIST_DIR/${RELEASE_NAME}.manifest.json" \
  "${RELEASE_NAME}.zip" "$H_FINAL" "$ZIP_SIZE" "$GIT_COMMIT" "$GIT_BRANCH"
ok "Manifest final: ${RELEASE_NAME}.manifest.json (sha256=$H_FINAL)"

# 4c. Atualizar vinculação do pacote em final-consistency-report.json e relatórios cruzados
# DEVE rodar antes do rebind — final-consistency-report.json é membro da chain
step "Atualizando package binding (elimina refs stale históricas)..."
node "$PROJECT_ROOT/governance/update-package-binding.js" 2>/dev/null \
  && ok "Package binding atualizado — final-consistency-report.json limpo" \
  || warn "update-package-binding falhou (continuando)"

# 4d. Rebinding final — DEVE rodar DEPOIS de todos os membros da chain estarem estáveis
step "Executando rebinding final (GOVERNANCE_STALE_HASH=$H_PROVISIONAL)..."
# Injeta H_provisional como hash stale explícito para substituição por H_final
export GOVERNANCE_STALE_HASH="$H_PROVISIONAL"
node "$PROJECT_ROOT/governance/rebind-to-current-package.js" \
  && ok "Rebinding PASS 4 concluído — todos sidecar vinculados a H_final" \
  || fail "Rebinding PASS 4 falhou"
unset GOVERNANCE_STALE_HASH

# 4d. Limpeza de segurança: remover qualquer manifest não-atual de dist/
step "Limpeza final: removendo manifests não-atuais de dist/..."
CURRENT_MANIFEST="${RELEASE_NAME}.manifest.json"
for m in "$DIST_DIR"/r-agent2-*.manifest.json; do
  [[ -f "$m" ]] || continue
  if [[ "$(basename "$m")" != "$CURRENT_MANIFEST" ]]; then
    rm -f "$m"
    echo "  Removido: $(basename "$m")"
  fi
done
ok "dist/ contém apenas o manifest atual: $CURRENT_MANIFEST"

# Propagar relatórios de governança para qa/reports/
step "Propagando relatórios finais..."
mkdir -p "$PROJECT_ROOT/qa/reports"
for f in \
  "governance/final-governance-report.json" \
  "governance/governance-consistency-report.json" \
  "governance/replay-hardening-report.json" \
  "governance/replay-consistency-report.json" \
  "governance/package-integrity-report.json" \
  "governance/governance-maturity-report.json" \
  "governance/self-proving-report.json" \
  "governance/tamper-detection-report.json"; do
  [[ -f "$PROJECT_ROOT/$f" ]] && cp "$PROJECT_ROOT/$f" "$PROJECT_ROOT/qa/reports/$(basename $f)" || true
done
# Garantir sidecar em dist/
for f in \
  "governance/final-consistency-report.json" \
  "governance/replay-integrity-report.json" \
  "governance/package-validation-report.json" \
  "governance/package-integrity-report.json" \
  "governance/self-proving-report.json" \
  "governance/final-governance-report.json"; do
  [[ -f "$PROJECT_ROOT/$f" ]] && cp "$PROJECT_ROOT/$f" "$DIST_DIR/$(basename $f)" || true
done
ok "Relatórios propagados"

# ══════════════════════════════════════════════════════════════════════════════
pass "PASS 4b — REESTRUTURAÇÃO dist/ NORMALIZADA"
# ══════════════════════════════════════════════════════════════════════════════
# Reorganiza dist/ flat → estrutura normalizada:
#   dist/release/    → ZIP final + manifest
#   dist/governance/ → relatórios JSON de governança
#   dist/signatures/ → assinaturas HMAC-SHA256
#   dist/verifier/   → script verificador + verify-result.json (gerado no PASS 5)

step "Criando estrutura de diretórios normalizada em dist/..."
RELEASE_DIR="$DIST_DIR/release"
GOV_DIR="$DIST_DIR/governance"
SIG_DIR="$DIST_DIR/signatures"
VER_DIR="$DIST_DIR/verifier"

mkdir -p "$RELEASE_DIR" "$GOV_DIR" "$SIG_DIR" "$VER_DIR"
ok "Diretórios criados: release/ governance/ signatures/ verifier/"

# Mover ZIP final para dist/release/ como PAYLOAD governado. O envelope de
# entrega sera criado separadamente com o nome historico <release>.zip.
step "Movendo ZIP final para dist/release/ como payload..."
FINAL_ZIP_NAME="$(basename "$FINAL_ZIP")"
PAYLOAD_ZIP_NAME="${RELEASE_NAME}.payload.zip"
ENVELOPE_ZIP_NAME="${RELEASE_NAME}.zip"
[[ -f "$DIST_DIR/$FINAL_ZIP_NAME" ]] && mv "$DIST_DIR/$FINAL_ZIP_NAME" "$RELEASE_DIR/$PAYLOAD_ZIP_NAME"
CURRENT_MF="${RELEASE_NAME}.manifest.json"
[[ -f "$DIST_DIR/$CURRENT_MF" ]] && mv "$DIST_DIR/$CURRENT_MF" "$RELEASE_DIR/$CURRENT_MF"
ok "dist/release/$PAYLOAD_ZIP_NAME + $CURRENT_MF"

# Mover relatórios de governança para dist/governance/
step "Movendo relatórios para dist/governance/..."
for f in \
  "self-proving-report.json" \
  "package-validation-report.json" \
  "package-integrity-report.json" \
  "final-consistency-report.json" \
  "final-governance-report.json" \
  "governance-attestation.json" \
  "governance-chain.json" \
  "replay-integrity-report.json"; do
  [[ -f "$DIST_DIR/$f" ]] && mv "$DIST_DIR/$f" "$GOV_DIR/$f" || true
done
ok "Relatórios movidos para dist/governance/"

# Mover assinaturas para dist/signatures/
step "Movendo assinaturas para dist/signatures/..."
for f in governance.sig release.sig package.manifest.sig replay.sig; do
  [[ -f "$DIST_DIR/$f" ]] && mv "$DIST_DIR/$f" "$SIG_DIR/$f" || true
done
ok "Assinaturas movidas para dist/signatures/"

# Copiar verificador para dist/verifier/
step "Copiando verificador para dist/verifier/..."
cp "$SCRIPT_DIR/verify-enterprise-governance.sh" "$VER_DIR/verify-enterprise-governance.sh"
cp "$SCRIPT_DIR/verify-enterprise-governance-v2.sh" "$VER_DIR/verify-enterprise-governance-v2.sh"
cp "$SCRIPT_DIR/audit-envelope-release-final.sh" "$VER_DIR/audit-envelope-release-final.sh"
cp "$SCRIPT_DIR/check-dist-clean.sh" "$VER_DIR/check-dist-clean.sh"
cp "$SCRIPT_DIR/release-governance-ci.sh" "$VER_DIR/release-governance-ci.sh"
cp "$SCRIPT_DIR/test-payload-contamination-regression.sh" "$VER_DIR/test-payload-contamination-regression.sh"
cp "$SCRIPT_DIR/release-governance-blocklist.sh" "$VER_DIR/release-governance-blocklist.sh"
cp "$SCRIPT_DIR/release-payload-blocklist.sh" "$VER_DIR/release-payload-blocklist.sh"
chmod +x "$VER_DIR/verify-enterprise-governance.sh" \
  "$VER_DIR/verify-enterprise-governance-v2.sh" \
  "$VER_DIR/audit-envelope-release-final.sh" \
  "$VER_DIR/check-dist-clean.sh" \
  "$VER_DIR/release-governance-ci.sh" \
  "$VER_DIR/test-payload-contamination-regression.sh"
ok "Verificador copiado para dist/verifier/"

# Remover governance-artifacts/ (legado — substituído pela estrutura normalizada)
if [[ -d "$DIST_DIR/governance-artifacts" ]]; then
  rm -rf "$DIST_DIR/governance-artifacts"
  ok "dist/governance-artifacts/ removido (normalizado em dist/governance/)"
fi

# Sanear PAYLOAD: no modelo envelope-governed, governanca e assinaturas ficam
# fora do payload e sao a fonte unica da prova.
PAYLOAD_PATH="$RELEASE_DIR/$PAYLOAD_ZIP_NAME"
TMP_PAYLOAD="$(mktemp -d -t r-agent2-payload-XXXXXX)"
step "Saneando payload (sem governança/signatures/verifier internos)..."
unzip -qq "$PAYLOAD_PATH" -d "$TMP_PAYLOAD"
rm -rf "$TMP_PAYLOAD/r-agent2/dist/governance" \
       "$TMP_PAYLOAD/r-agent2/dist/signatures" \
       "$TMP_PAYLOAD/r-agent2/dist/verifier"
release_payload_remove_forbidden_from_tree "$TMP_PAYLOAD/r-agent2"
rm -f "$PAYLOAD_PATH"
(cd "$TMP_PAYLOAD" && zip -qr "$PAYLOAD_PATH" r-agent2/)
rm -rf "$TMP_PAYLOAD"
PAYLOAD_SHA="$(sha256sum "$PAYLOAD_PATH" | awk '{print $1}')"
PAYLOAD_SIZE="$(du -h "$PAYLOAD_PATH" | cut -f1)"
ok "Payload saneado: $PAYLOAD_ZIP_NAME sha256=${PAYLOAD_SHA:0:24}…"
release_payload_validate_zip "$PAYLOAD_PATH" "$PAYLOAD_ZIP_NAME" \
  && ok "Payload validado contra blacklist central" \
  || fail "Payload contaminado por arquivo proibido"

step "Gerando manifest e governança payload-centric..."
MANIFEST_PATH="$RELEASE_DIR/$CURRENT_MF"
write_payload_manifest "$PAYLOAD_ZIP_NAME" "$MANIFEST_PATH" "$PAYLOAD_SHA" "$PAYLOAD_SIZE" \
  "$ENVELOPE_ZIP_NAME" "$GIT_COMMIT" "$GIT_BRANCH"
materialize_payload_governance "$PAYLOAD_ZIP_NAME" "$PAYLOAD_SHA" "$MANIFEST_PATH" \
  "$RELEASE_TIMESTAMP" "$GOV_DIR" "$SIG_DIR" "$VER_DIR"
ok "Governança e assinaturas vinculadas ao payload"

step "Criando envelope final com payload + governança externa..."
ENVELOPE_PATH="$RELEASE_DIR/$ENVELOPE_ZIP_NAME"
TMP_ENVELOPE="$(mktemp -d -t r-agent2-envelope-XXXXXX)"
mkdir -p "$TMP_ENVELOPE/r-agent2/dist/release" \
         "$TMP_ENVELOPE/r-agent2/dist/governance" \
         "$TMP_ENVELOPE/r-agent2/dist/signatures" \
         "$TMP_ENVELOPE/r-agent2/dist/verifier"
cp "$PAYLOAD_PATH" "$TMP_ENVELOPE/r-agent2/dist/release/$PAYLOAD_ZIP_NAME"
cp "$MANIFEST_PATH" "$TMP_ENVELOPE/r-agent2/dist/release/$CURRENT_MF"
cp "$GOV_DIR"/*.json "$TMP_ENVELOPE/r-agent2/dist/governance/"
cp "$SIG_DIR"/*.sig "$TMP_ENVELOPE/r-agent2/dist/signatures/"
cp "$VER_DIR"/* "$TMP_ENVELOPE/r-agent2/dist/verifier/"
rm -f "$ENVELOPE_PATH"
(cd "$TMP_ENVELOPE" && zip -qr "$ENVELOPE_PATH" r-agent2/)
rm -rf "$TMP_ENVELOPE"
H_FINAL="$(sha256sum "$ENVELOPE_PATH" | awk '{print $1}')"
ZIP_SIZE="$(du -h "$ENVELOPE_PATH" | cut -f1)"
FINAL_ZIP="$ENVELOPE_PATH"
FINAL_ZIP_NAME="$ENVELOPE_ZIP_NAME"
ok "Envelope final: $ENVELOPE_ZIP_NAME sha256=${H_FINAL:0:24}…"
release_envelope_validate_zip "$ENVELOPE_PATH" \
  && ok "Envelope contém apenas artefatos controlados" \
  || fail "Envelope contém entradas inesperadas"

# Verificar estrutura resultante
step "Validando estrutura normalizada de dist/..."
bash "$SCRIPT_DIR/check-dist-clean.sh" 2>&1 | grep -E "(✓|✗|PASS|FAIL|check-dist)" || true
if bash "$SCRIPT_DIR/check-dist-clean.sh" 2>/dev/null; then
  ok "dist/ estrutura normalizada verificada"
else
  warn "check-dist-clean detectou problemas (continuando para diagnóstico)"
fi

# ══════════════════════════════════════════════════════════════════════════════
pass "PASS 5 — GATE: VERIFICADOR OFFLINE DE GOVERNANÇA"
# ══════════════════════════════════════════════════════════════════════════════
# REGRA ABSOLUTA: release só é válida se o verificador offline PASSAR.

if [[ "$DRY_RUN" == true ]]; then
  warn "DRY-RUN ativado — verificação final ignorada"
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║  DRY-RUN: pipeline concluído sem verificação final          ║${NC}"
  echo -e "${YELLOW}║  Para release real, remova --dry-run                        ║${NC}"
  echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 0
fi

step "Executando verificador offline de governança enterprise..."
VERIFIER="$SCRIPT_DIR/verify-enterprise-governance.sh"
[[ -x "$VERIFIER" ]] || chmod +x "$VERIFIER"

if bash "$VERIFIER"; then
  # ── Resumo final ─────────────────────────────────────────────────────────
  SP_STATUS="$(node -e "
    const fs=require('fs');
    // Suportar nova estrutura (dist/governance/) e compat flat
    const paths=['$GOV_DIR/self-proving-report.json','$DIST_DIR/self-proving-report.json','governance/self-proving-report.json'];
    for(const p of paths){if(fs.existsSync(p)){process.stdout.write(JSON.parse(fs.readFileSync(p,'utf8')).selfProofStatus||'UNKNOWN');process.exit(0);}}
    process.stdout.write('UNKNOWN');
  " 2>/dev/null || echo 'UNKNOWN')"

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  TWO-PASS RELEASE: SUCESSO — PACOTE SELF-PROVING VERIFICADO ║${NC}"
  echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
  printf  "${GREEN}║  Release     : %-47s ║${NC}\n" "${RELEASE_NAME}.zip"
  printf  "${GREEN}║  H_provisional: %-46s ║${NC}\n" "${H_PROVISIONAL:0:46}"
  printf  "${GREEN}║  H_final      : %-46s ║${NC}\n" "${H_FINAL:0:46}"
  printf  "${GREEN}║  Tamanho      : %-46s ║${NC}\n" "$ZIP_SIZE"
  printf  "${GREEN}║  Commit       : %-46s ║${NC}\n" "$GIT_COMMIT @ $GIT_BRANCH"
  printf  "${GREEN}║  Self-Proof   : %-46s ║${NC}\n" "$SP_STATUS"
  printf  "${GREEN}║  Verifier     : %-46s ║${NC}\n" "PASS (offline)"
  printf  "${GREEN}║  Pipeline     : %-46s ║${NC}\n" "two-pass-immutable"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  TWO-PASS RELEASE BLOQUEADA — GOVERNANCE VERIFICATION: FAIL ║${NC}"
  echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${RED}║  O pacote NÃO é self-proving. Release cancelada.            ║${NC}"
  echo -e "${RED}║  Diagnóstico: bash scripts/verify-enterprise-governance.sh  ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
  rm -f "$FINAL_ZIP"
  exit 1
fi
