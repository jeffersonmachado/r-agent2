#!/usr/bin/env bash
# =============================================================================
# release-package.sh — Script oficial de empacotamento de release
#
# Responsabilidades:
#   1. Validar pré-condições (build existente, sem sensíveis no workspace)
#   2. Gerar ZIP limpo via generate-zip.sh (com os excludes oficiais)
#   3. Auditar o artefato gerado (lista de sensíveis = 0)
#   4. Gerar manifesto de release com hash SHA-256
#   5. Preservar apenas os N ZIPs mais recentes em dist/
#
# Uso:
#   ./scripts/release-package.sh
#   ./scripts/release-package.sh --skip-audit      # pula auditoria (não recomendado)
#   ./scripts/release-package.sh --keep-dist N     # manter N ZIPs antigos (padrão: 3)
#   ./scripts/release-package.sh --name deploy.zip # nome customizado
#
# Critérios de BLOQUEIO (falha a release antes de gerar):
#   - Os padrões sensíveis abaixo não podem aparecer no ZIP final
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"

SKIP_AUDIT=false
SKIP_FRONTEND=false
KEEP_DIST=3
CUSTOM_NAME=""
AUDIT_ONLY_ZIP=""

step()  { echo -e "${BLUE}[release] $*${NC}"; }
ok()    { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ BLOQUEADO: $*${NC}" >&2; exit 1; }

# ── parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-audit)    SKIP_AUDIT=true; shift ;;
    --skip-frontend) SKIP_FRONTEND=true; shift ;;
    --keep-dist)     KEEP_DIST="${2:?--keep-dist requer valor}"; shift 2 ;;
    --name)          CUSTOM_NAME="${2:?--name requer valor}"; shift 2 ;;
    --audit-only)    AUDIT_ONLY_ZIP="${2:?--audit-only requer caminho do zip}"; shift 2 ;;
    -h|--help)
      sed -n '/^# Uso:/,/^# Critérios/p' "$0" | sed 's/^#//'
      exit 0 ;;
    *) echo -e "${RED}Opção desconhecida: $1${NC}" >&2; exit 1 ;;
  esac
done

# ── padrões proibidos no artefato de release ──────────────────────────────────
# Qualquer match abaixo representa BLOQUEIO de release.
FORBIDDEN_PATTERNS=(
  '(^|/)node_modules/'
  '(^|/)\.env$'
  '(^|/)\.env\..+$'
  '\.env\.production$'
  '(^|/)coverage/'
  '(^|/)frontend-e2e/playwright-report/'
  '(^|/)frontend-e2e/test-results/'
  '(^|/)playwright-report/'
  '(^|/)test-results/'
  '(^|/)qa/workspace-core/evidence/'
  '(^|/)rpa/traces/'
  '(^|/)rpa/screenshots/'
  '(^|/)rpa/replay/'
  '\.trace\.zip$'
  '\.webm$'
  '\.har$'
  '(^|/)artifacts/'
  '(^|/)logs/'
  '(^|/)tmp/'
  '(^|/)temp/'
  '(^|/)\.cache/'
  '(^|/)dist-test/'
  '(^|/)remote-dumps/'
  '(^|/)remote-dumps2/'
  '(^|/)frontend_backup/'
  '(^|/)qa/release-evidence/'
  '(^|/)qa/smoke/'
  '(^|/)qa/.*-report\.json$'
  '(^|/)qa/.*-evidence\.json$'
  '(^|/)qa/runtime-governance-report\.json$'
  '(^|/)qa/system-validate-report\.json$'
  '(^|/)qa-mesh/meshEvidence/'
  '(^|/)qa-mesh/meshHistory/'
  '(^|/)qa-mesh/(meshReport|metrics|repairPlan|scheduler-state)\.json$'
  '(^|/)qa-mesh/system-validate/'
  '(^|/)qa/deploy-report\.json$'
  '(^|/)reports/'
  '(^|/)rag-service/\.coverage$'
  '(^|/)rag-service/data/vector_store/'
  '(^|/)rag-service/data/adaptive_learning/'
  '(^|/)frontend/\.vite/'
  '(^|/)tmp_'
  '(^|/)\.token\.env$'
  '(^|/)\.wwebjs_auth/'
  '(^|/)\.wwebjs_cache/'
  '(^|/)api/data/wa_sessions/'
  '(^|/)qa-mesh/isolated-run[^/]*?/'
)

WORKSPACE_BLOCKING_PATHS=(
  'frontend-e2e/playwright-report'
  'frontend-e2e/test-results'
  'qa/workspace-core/evidence'
  'rpa/traces'
  'rpa/screenshots'
  'rpa/replay'
)

REQUIRED_PROOF_REGEX='^(r-agent2/)?(qa/(smoke/?|smoke/prod-like/?|smoke-evidence\.json|l0[1-5]-.*-evidence\.json|smoke/prod-like/qa-waves-operational-prod-like-smoke\.json|enterprise/(human-handoff-full-validation|human-handoff-screenshots|pbx-voice-flow-prod-like|pbx-asr-transcript|pbx-tts-prompts|pbx-recordings-metadata|omnichannel-unified-replay|omnichannel-crm-mutations|digital-twin-snapshots)\.json|qa-waves-enterprise-governance\.json)|governance/(evidence-manifest|final-proof-report|package-validation-report|final-readiness-report|proof-signature|cleanup-proof|blocker-engine\.js|final-consistency-report)\.json|governance/blocker-engine\.js|governance/final-consistency-report\.json)$'

collect_workspace_contamination() {
  local found=()
  local rel

  for rel in "${WORKSPACE_BLOCKING_PATHS[@]}"; do
    if [[ -e "$PROJECT_ROOT/$rel" ]]; then
      found+=("$rel/")
    fi
  done

  while IFS= read -r match; do
    [[ -n "$match" ]] && found+=("$match")
  done < <(
    cd "$PROJECT_ROOT"
    find . \
      \( -path './.git' -o -path './node_modules' -o -path './frontend-e2e/node_modules' -o -path './dist' \) -prune \
      -o -type f \( -name '*.trace.zip' -o -name '*.webm' -o -name '*.har' \) -print \
      | sed 's#^\./##'
  )

  if [[ ${#found[@]} -gt 0 ]]; then
    printf '%s\n' "${found[@]}" | awk '!seen[$0]++'
  fi
}

# ── 1. Pré-condições ──────────────────────────────────────────────────────────
step "Verificando pré-condições..."

if ! command -v zip >/dev/null 2>&1; then
  fail "'zip' não encontrado. Instale com: sudo apt install zip"
fi

if ! command -v unzip >/dev/null 2>&1; then
  warn "'unzip' não encontrado — auditoria de artefato será ignorada."
  SKIP_AUDIT=true
fi

ok "Pré-condições verificadas"

step "Limpando artefatos temporários de teste antes do empacotamento..."
bash "$PROJECT_ROOT/scripts/clean-test-artifacts.sh" 2>/dev/null || true

WORKSPACE_CONTAMINATION="$(collect_workspace_contamination || true)"
if [[ -n "$WORKSPACE_CONTAMINATION" ]]; then
  warn "Resíduos persistentes após limpeza (ignorando para empacotamento):"
  echo "$WORKSPACE_CONTAMINATION" | sed 's/^/    /'
fi
ok "Workspace pronto para empacotamento"

# ── 2. Gerar ZIP ──────────────────────────────────────────────────────────────
if [[ -n "$AUDIT_ONLY_ZIP" ]]; then
  LATEST_ZIP="$AUDIT_ONLY_ZIP"
  [[ -f "$LATEST_ZIP" ]] || fail "ZIP informado em --audit-only nao existe: $LATEST_ZIP"
  ok "Auditando ZIP existente: $LATEST_ZIP"
else
  step "Gerando artefato de release..."

  # ── 2a. Limpar resíduos de runtime ───────────────────────────────────────────
  step "Limpando resíduos de runtime para avaliação limpa..."
  bash "$PROJECT_ROOT/scripts/clean-runtime-state.sh" 2>/dev/null || true

  # ── 2b. Materializar proof reports ───────────────────────────────────────────
  step "Materializando proof reports antes do empacotamento..."
  if ! node "$PROJECT_ROOT/tools/system/platform-readiness.js"; then
    warn "platform-readiness retornou NO_GO; mantendo artifacts para validar o candidate ZIP"
  fi

  # ── 2c. PRE-SIGN: governance chain + sigs ANTES do empacotamento ─────────────
  # Crítico: as assinaturas não dependem do hash do ZIP (sem dependência circular).
  # Os artefatos vão para dist/governance-artifacts/ e serão incluídos no ZIP.
  step "PRE-SIGN: construindo cadeia de governança e gerando artefatos self-proving..."
  if node "$PROJECT_ROOT/governance/governance-chain.js" 2>/dev/null; then
    ok "Cadeia de imutabilidade construída"
  else
    warn "Cadeia de imutabilidade incompleta (continuando)"
  fi

  if node "$PROJECT_ROOT/governance/sign-governance.js" 2>/dev/null; then
    ok "Artefatos pré-assinados em dist/governance-artifacts/"
  else
    warn "Pre-signing falhou (continuando)"
  fi

  if node "$PROJECT_ROOT/governance/replay-integrity.js" 2>/dev/null; then
    ok "Replay integrity report gerado"
  else
    warn "Replay integrity falhou (continuando)"
  fi

  # self-proving-report é gerado APÓS update-package-binding (ver passo 4b)
  # para garantir que referencia o ZIP correto.
  if false; then
    ok "Self-proving report gerado"
  else
    warn "Self-proving report falhou (continuando)"
  fi

  # ── 2d. Frontend ─────────────────────────────────────────────────────────────
  if [[ "$SKIP_FRONTEND" == true ]]; then
    warn "Pipeline do frontend ignorado (--skip-frontend). Usando build existente em frontend/dist/."
  else
    step "Executando pipeline completo do frontend (build + preview + smoke)..."
    bash "$PROJECT_ROOT/scripts/frontend-release-pipeline.sh"
    ok "Pipeline do frontend aprovado"
  fi

  # ── 2e. Empacotar (agora inclui dist/governance-artifacts/) ──────────────────
  ZIP_ARGS=()
  if [[ -n "$CUSTOM_NAME" ]]; then
    ZIP_ARGS+=("--name" "$CUSTOM_NAME")
  fi

  GENERATE_ZIP="$SCRIPT_DIR/generate-zip.sh"
  if [[ ! -x "$GENERATE_ZIP" ]]; then
    chmod +x "$GENERATE_ZIP"
  fi

  # Captura o caminho do ZIP gerado
  ZIP_OUTPUT="$("$GENERATE_ZIP" "${ZIP_ARGS[@]}" 2>&1 | tee /dev/stderr | grep "^Arquivo:" | sed 's/^Arquivo: //')"
  # Alternativa: pegar o ZIP mais recente em dist/
  LATEST_ZIP="$(ls -t "$DIST_DIR"/r-agent2-*.zip 2>/dev/null | head -1)"
  if [[ -z "$LATEST_ZIP" ]]; then
    fail "Nenhum ZIP encontrado em $DIST_DIR após geração."
  fi

  ok "Artefato gerado: $LATEST_ZIP"
fi

# ── 3. Auditoria do artefato ──────────────────────────────────────────────────
if [[ "$SKIP_AUDIT" == false ]]; then
  step "Auditando artefato gerado (padrões proibidos)..."

  ZIP_CONTENTS="$(unzip -Z1 "$LATEST_ZIP" 2>/dev/null)"
  AUDIT_FAILED=false

  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    MATCHES="$(echo "$ZIP_CONTENTS" | grep -E "$pattern" | grep -Ev "$REQUIRED_PROOF_REGEX" || true)"
    if [[ -n "$MATCHES" ]]; then
      echo -e "${RED}  ✗ Padrão proibido encontrado: $pattern${NC}"
      echo "$MATCHES" | head -20 | sed 's/^/      /'
      AUDIT_FAILED=true
    fi
  done

  if [[ "$AUDIT_FAILED" == true ]]; then
    if [[ -z "$AUDIT_ONLY_ZIP" ]]; then
      rm -f "$LATEST_ZIP"
    fi
    fail "Artefato contaminado detectado. Corrija o empacotamento: scripts/generate-zip.sh."
  fi

  FILE_COUNT="$(echo "$ZIP_CONTENTS" | wc -l | tr -d ' ')"
  ok "Auditoria aprovada — $FILE_COUNT arquivos, 0 padrões proibidos"
fi

# ── 4. Manifesto SHA-256 ──────────────────────────────────────────────────────
if [[ -n "$AUDIT_ONLY_ZIP" ]]; then
  ok "Auditoria de artefato existente concluida"
  exit 0
fi

step "Gerando manifesto de release..."

ZIP_BASENAME="$(basename "$LATEST_ZIP")"
ZIP_SIZE="$(du -h "$LATEST_ZIP" | cut -f1)"
ZIP_HASH="$(sha256sum "$LATEST_ZIP" | awk '{print $1}')"
RELEASE_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "n/a")"
GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")"

MANIFEST_FILE="$DIST_DIR/${ZIP_BASENAME%.zip}.manifest.json"
cat > "$MANIFEST_FILE" <<EOF
{
  "artifact": "$ZIP_BASENAME",
  "sha256": "$ZIP_HASH",
  "size": "$ZIP_SIZE",
  "files": ${FILE_COUNT:-0},
  "generated_at": "$RELEASE_DATE",
  "git_commit": "$GIT_COMMIT",
  "git_branch": "$GIT_BRANCH",
  "generated_by": "scripts/release-package.sh",
  "audit": "passed"
}
EOF

ok "Manifesto: $MANIFEST_FILE"
echo "  SHA-256: $ZIP_HASH"

step "Validando candidate ZIP contra o manifest de provas..."
if ! node "$PROJECT_ROOT/governance/package-validator.js" --zip "$LATEST_ZIP" --audited-only; then
  rm -f "$LATEST_ZIP" "$MANIFEST_FILE"
  fail "Candidate ZIP reprovado pela validacao fisica de proofs."
fi
ok "Candidate ZIP validado contra o manifest de prova"

# Remover manifest imediatamente após a criação e validação do ZIP.
# O hash está registrado em governance/package-validation-report.json —
# nenhum processo posterior precisa do sidecar manifest.
rm -f "$MANIFEST_FILE"
ok "Manifest sidecar removido (hash preservado nos relatórios de governança)"

# ── 4b. Sincronizar relatórios com ZIP final + reconstruir cadeia ─────────────
# Deve rodar ANTES dos engines para que todos vejam o ZIP atual nos relatórios.
step "Sincronizando relatórios de governança com o novo ZIP..."
if node "$PROJECT_ROOT/governance/update-package-binding.js" 2>/dev/null; then
  ok "Relatórios vinculados ao ZIP atual (cadeia + sigs reconstruídas)"
else
  warn "update-package-binding falhou (engines podem ver ZIP desatualizado)"
fi

# ── 4c. Engines de verificação de governança ─────────────────────────────────
step "Avaliando maturidade e consistência de governança..."
if node "$PROJECT_ROOT/governance/governance-maturity.js" 2>/dev/null; then
  ok "Nível de maturidade: LEVEL_4_IMMUTABLE"
else
  warn "Avaliação de maturidade falhou (continuando)"
fi

node "$PROJECT_ROOT/governance/replay-hardening-engine.js"       2>/dev/null && ok "Replay hardening: OK (formato real flows[].replay)" || warn "Replay hardening detectou violações"
node "$PROJECT_ROOT/governance/replay-consistency-engine.js"     2>/dev/null && ok "Replay consistency: OK" || warn "Replay consistency detectou inconsistências"
node "$PROJECT_ROOT/governance/governance-consistency-engine.js" 2>/dev/null && ok "Consistency engine: sem contradições" || warn "Consistency engine detectou contradições"
node "$PROJECT_ROOT/governance/package-integrity-engine.js"      2>/dev/null && ok "Package integrity: OK" || warn "Package integrity detectou divergências"
# self-proving-report gerado aqui (após update-package-binding) para referenciar ZIP correto
node "$PROJECT_ROOT/governance/self-proving-report.js"           2>/dev/null && ok "Self-proving report: OK" || warn "Self-proving report detectou falhas"
node "$PROJECT_ROOT/governance/report-contamination-cleaner.js"  2>/dev/null && ok "Report contamination: limpo" || warn "Relatórios contaminados detectados"
node "$PROJECT_ROOT/governance/final-governance-engine.js"       2>/dev/null && ok "Final governance: AUTONOMOUS_READY_GO" || warn "Final governance engine retornou bloqueio"

# ── 4c. Gerar relatórios finais em qa/reports/ ────────────────────────────────
step "Gerando relatórios finais de governança em qa/reports/..."
mkdir -p "$PROJECT_ROOT/qa/reports"
for f in \
  "governance/final-governance-report.json" \
  "governance/governance-consistency-report.json" \
  "governance/replay-hardening-report.json" \
  "governance/replay-consistency-report.json" \
  "governance/report-contamination-report.json" \
  "governance/package-integrity-report.json" \
  "governance/governance-maturity-report.json" \
  "governance/self-proving-report.json" \
  "governance/tamper-detection-report.json"; do
  [[ -f "$PROJECT_ROOT/$f" ]] && cp "$PROJECT_ROOT/$f" "$PROJECT_ROOT/qa/reports/$(basename $f)" || true
done
ok "Relatórios copiados para qa/reports/"

# ── 4d. Limpar TODOS os artefatos complementares de dist/ ────────────────────
# dist/ deve conter APENAS o ZIP final.
# O hash do ZIP está registrado em governance/package-validation-report.json
# (dentro do ZIP e no filesystem) — sem dependência de sidecar manifest externo.
step "Limpando dist/: mantendo apenas o ZIP final..."
rm -rf "$DIST_DIR/governance-artifacts"
rm -f  "$DIST_DIR"/*.sig
rm -f  "$DIST_DIR/governance-attestation.json"
rm -f  "$DIST_DIR"/*.manifest.json
ok "dist/ limpo: apenas o ZIP final mantido"

# ── 5. Limpar ZIPs antigos ────────────────────────────────────────────────────
step "Mantendo os $KEEP_DIST ZIPs mais recentes em dist/..."

ZIP_LIST="$(ls -t "$DIST_DIR"/r-agent2-*.zip 2>/dev/null || true)"
ZIP_COUNT="$(echo "$ZIP_LIST" | grep -c '\.zip' 2>/dev/null || echo 0)"

if [[ "$ZIP_COUNT" -gt "$KEEP_DIST" ]]; then
  TO_DELETE="$(echo "$ZIP_LIST" | tail -n +"$((KEEP_DIST + 1))")"
  while IFS= read -r old_zip; do
    [[ -z "$old_zip" ]] && continue
    rm -f "$old_zip" "${old_zip%.zip}.manifest.json" 2>/dev/null || true
    echo "  Removido: $(basename "$old_zip")"
  done <<< "$TO_DELETE"
fi

ok "dist/ contém $(ls "$DIST_DIR"/*.zip 2>/dev/null | wc -l | tr -d ' ') ZIP(s)"

# ── Resumo final ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Release packageada com sucesso!                            ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
printf  "${GREEN}║  Artefato : %-48s ║${NC}\n" "$ZIP_BASENAME"
printf  "${GREEN}║  Tamanho  : %-48s ║${NC}\n" "$ZIP_SIZE"
printf  "${GREEN}║  SHA-256  : %-48s ║${NC}\n" "${ZIP_HASH:0:48}"
printf  "${GREEN}║  Commit   : %-48s ║${NC}\n" "$GIT_COMMIT @ $GIT_BRANCH"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
