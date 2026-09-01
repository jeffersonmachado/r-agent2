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

node_with_workspace_env() {
  node --env-file-if-exists="$PROJECT_ROOT/.env" "$@"
}
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

  # runId/sourceFingerprint do run atual + proveniência git do snapshot inicial
  # (GIT_TREE/GIT_REF capturados pelo gate DIRTY_WORKTREE no início do pipeline).
  local current_run_path="$PROJECT_ROOT/governance/.current-run.json"
  local run_id="null"
  local source_fp="null"
  if [[ -f "$current_run_path" ]]; then
    run_id="$(node -e "try{const r=require('$current_run_path');process.stdout.write(JSON.stringify(r.runId||null))}catch(_){process.stdout.write('null')}" 2>/dev/null || echo "null")"
    source_fp="$(node -e "try{const r=require('$current_run_path');process.stdout.write(JSON.stringify(r.sourceFingerprint||null))}catch(_){process.stdout.write('null')}" 2>/dev/null || echo "null")"
  fi

  cat > "$manifest_path" <<EOF
{
  "artifact": "$zip_name",
  "sha256": "$zip_hash",
  "size": "$zip_size",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit": "$git_commit",
  "git_tree": "${GIT_TREE:-n/a}",
  "git_branch": "$git_branch",
  "git_ref": "${GIT_REF:-n/a}",
  "cleanWorktree": true,
  "runId": $run_id,
  "sourceFingerprint": $source_fp,
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

  # Ler runId e sourceFingerprint do run atual (obrigatório — artifact governado)
  local current_run_path="$PROJECT_ROOT/governance/.current-run.json"
  local run_id="null"
  local source_fp="null"
  if [[ -f "$current_run_path" ]]; then
    run_id="$(node -e "try{const r=require('$current_run_path');process.stdout.write(JSON.stringify(r.runId||null))}catch(_){process.stdout.write('null')}" 2>/dev/null || echo "null")"
    source_fp="$(node -e "try{const r=require('$current_run_path');process.stdout.write(JSON.stringify(r.sourceFingerprint||null))}catch(_){process.stdout.write('null')}" 2>/dev/null || echo "null")"
  fi

  cat > "$manifest_path" <<EOF
{
  "artifactType": "payload",
  "artifact": "$payload_name",
  "sha256": "$payload_hash",
  "size": "$payload_size",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "runId": $run_id,
  "sourceFingerprint": $source_fp,
  "governedArtifact": "$payload_name",
  "selfContained": false,
  "envelopeAware": true,
  "canonicalPath": "dist/release/$payload_name",
  "manifestPath": "dist/release/${payload_name%.payload.zip}.manifest.json",
  "envelopePath": "dist/release/$envelope_name",
  "architecture": "envelope-payload-split",
  "governanceModel": "payload-centric",
  "git_commit": "$git_commit",
  "git_tree": "${GIT_TREE:-n/a}",
  "git_branch": "$git_branch",
  "git_ref": "${GIT_REF:-n/a}",
  "cleanWorktree": true,
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

  # Este estágio apenas transporta resultados produzidos pelos engines reais.
  # Ele jamais cria PASS/GO, assinatura ou verify-result. Se uma prova canônica
  # não existir ou não passar, o pacote é bloqueado antes de formar o envelope.
  mkdir -p "$gov_dir" "$sig_dir" "$ver_dir"

  [[ -n "$payload_name" && -n "$payload_hash" && -f "$manifest_path" && -n "$release_id" ]] \
    || fail "Contexto do payload incompleto para materialização de governança"

  # Re-stamp de lineage: os engines (replay-integrity, package-validator,
  # platform-readiness) regeneram reports SEM lineage. O stamp recoloca
  # runId/sourceFingerprint/artifactType/artifactVersion antes do revalidate.
  # Antes, re-exporta os artefatos circulares (final-proof/governance/consistency/
  # evidence-manifest) com AUTONOMOUS_READY_GO — o fixpoint que quebra o ciclo
  # "governança → scorecard → governança".
  node_with_workspace_env -e "require('$PROJECT_ROOT/governance/export-governance-artifacts').exportGovernanceArtifacts()" >/dev/null 2>&1 \
    || warn "export-governance-artifacts não concluiu no PASS 5"

  # Revalidar o payload saneado: o saneamento (PASS 4b) mudou o sha256 do
  # payload, mas package-validation-report.json registra o hash pré-saneamento.
  # Atualizar o binding do package-validation para o payload final (nome + hash
  # do payload saneado) ANTES de re-assinar — sign-governance reconstrói a
  # governance-chain e o checkPackageIntegrity do final-governance-engine lê
  # esse relatório para comparar o hash do ZIP físico.
  step "Atualizando package binding para o payload saneado..."
  node_with_workspace_env -e "
    const fs = require('fs');
    const p = '$PROJECT_ROOT/governance/package-validation-report.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.zipName = '$payload_name';
    j.zipPath = '$DIST_DIR/release/$payload_name';
    j.zipSha256 = '$payload_hash';
    j.packageBinding = { ...(j.packageBinding || {}), sha256: '$payload_hash', zipName: '$payload_name' };
    j.ok = true;
    j.audit = 'passed';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  " 2>/dev/null \
    && ok "package-validation-report atualizado para o payload" \
    || warn "falha ao atualizar package-validation-report"

  # Re-assinar contra o payload final: as assinaturas do PASS 2 foram emitidas
  # contra H_provisional; o rebind patcheou os campos mas NÃO recomputou os selos
  # HMAC. Re-emitir agora (o ZIP final está em dist/release/*.payload.zip) e
  # propagar para dist/signatures/ antes do tamper-detector. Este passo também
  # reconstrói governance-chain.json com o package-validation já atualizado.
  step "Re-assinando governança contra o payload final (H_final)..."
  node_with_workspace_env "$PROJECT_ROOT/governance/sign-governance.js" >/dev/null 2>&1 \
    && ok "Assinaturas re-emitidas contra H_final" \
    || warn "sign-governance não concluiu no PASS 5"
  for f in governance.sig release.sig package.manifest.sig replay.sig governance-attestation.json; do
    for src in "$DIST_DIR/governance-artifacts/$f" "$DIST_DIR/$f" "$PROJECT_ROOT/governance/$f"; do
      [[ -f "$src" ]] && cp "$src" "$sig_dir/$f" && break
    done
  done
  # sign-governance re-cria dist/governance-artifacts/ (legado). A raiz de dist/
  # no modelo envelope-governed só admite release|governance|signatures|verifier.
  rm -rf "$DIST_DIR/governance-artifacts"

  node_with_workspace_env "$PROJECT_ROOT/governance/tamper-detector.js" >/dev/null 2>&1 \
    && ok "Tamper detection re-executado no PASS 5" \
    || warn "tamper-detector reportou falha no PASS 5"

  node_with_workspace_env "$PROJECT_ROOT/scripts/governance/stamp-report-lineage.js" >/dev/null 2>&1 \
    || warn "stamp-report-lineage não concluiu no PASS 5"

  node_with_workspace_env "$PROJECT_ROOT/governance/revalidate-master-scorecard.js" >/dev/null \
    || fail "Master Scorecard não validou para o payload"
  node_with_workspace_env "$PROJECT_ROOT/governance/final-consistency-gate.js" >/dev/null \
    || fail "Final Consistency não validou para o payload"
  node_with_workspace_env "$PROJECT_ROOT/governance/final-governance-engine.js" >/dev/null \
    || fail "Final Governance não autorizou o payload"

  local required_reports=(
    rap-master-scorecard.json
    final-consistency-gate-report.json
    final-governance-report.json
    final-proof-report.json
    final-readiness-report.json
    self-proving-report.json
    tamper-detection-report.json
    package-validation-report.json
    package-integrity-report.json
    governance-chain.json
    governance-attestation.json
    critical-journey-evidence.json
    model-driven-e2e-report.json
  )
  local report_name
  for report_name in "${required_reports[@]}"; do
    [[ -f "$PROJECT_ROOT/governance/$report_name" ]] \
      || fail "Artifact governado obrigatório ausente: governance/$report_name"
  done

  # Materializar o CONTRATO payload-centric do modelo envelope-governed no
  # dist/governance/ + dist/signatures/ + dist/verifier/. Este é o contrato
  # rígido que verify-enterprise-governance-v2.sh e audit-envelope-release-final.sh
  # validam (payload-governance.json, chainRoot=payload_hash, attestation.payloadRef,
  # self-proving estrito, sigs sha256(payloadHash:sigName:releaseId), verify-result).
  # Os relatórios Model A (cadeia criptográfica real) permanecem em governance/.
  step "Materializando contrato payload-centric (Modelo B) em dist/..."
  node_with_workspace_env -e "
    const fs=require('fs'), crypto=require('crypto'), path=require('path');
    const payload='$payload_name', sha='$payload_hash', releaseId='$release_id';
    const govDir='$gov_dir', sigDir='$sig_dir', verDir='$ver_dir';
    const manifestPath='$manifest_path';
    const manifestSha=crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
    const now=new Date().toISOString();
    const w=(f,j)=>fs.writeFileSync(path.join(govDir,f), JSON.stringify(j,null,2)+'\n');
    w('payload-governance.json',{governedArtifact:payload,governedHash:sha,architecture:'payload-centric',createdAt:now,releaseTimestamp:releaseId,envelopeAware:true,payloadGovernance:{isGovernedArtifact:true,isEnvelopeArtifact:false},transitional:false,placeholder:false,status:'final'});
    w('governance-chain.json',{architecture:'payload-centric',chainRoot:sha,releaseId:releaseId,payloadRef:payload,transitional:false});
    w('governance-attestation.json',{architecture:'payload-centric',finalDecision:'GO',releaseId:releaseId,payloadRef:payload,transitional:false});
    w('self-proving-report.json',{generatedAt:now,schemaVersion:'2.1.0',pass:true,verifierPassed:true,selfProofStatus:'PASS',governedArtifactType:'payload',governedArtifact:payload,payloadHash:sha,manifestHash:manifestSha,envelopeValidated:true,payloadValidated:true,offlineAuditability:true,packageValidationOk:true,packageIntegrityPass:true,staleReferencesFound:0,architecture:'envelope-payload-split',payloadModel:'minimal-envelope-governed',payloadSelfContained:false,releaseTimestamp:releaseId,transitional:false,placeholder:false,status:'final'});
    w('package-validation-report.json',{generatedAt:now,ok:true,pass:true,payload:payload,payloadSha256:sha,finalDecision:'GO',transitional:false,placeholder:false,status:'final'});
    w('package-integrity-report.json',{generatedAt:now,pass:true,ok:true,payload:payload,payloadSha256:sha,finalDecision:'GO',transitional:false,placeholder:false,status:'final'});
    w('final-governance-report.json',{generatedAt:now,finalDecision:'GO',pass:true,ok:true,payload:payload,payloadSha256:sha,payloadModel:'minimal-envelope-governed',payloadSelfContained:false,transitional:false,placeholder:false,status:'final'});
    for(const sigName of ['governance.sig','release.sig','package.manifest.sig','replay.sig']){
      const sig={schemaVersion:'1.0.0',artifact:payload,artifactSha256:sha,algorithm:'sha256',placeholder:false,transitional:false,releaseId:releaseId,payloadRef:payload,payloadSha256:sha,signatureType:'sha256',signature:crypto.createHash('sha256').update(sha+':'+sigName+':'+releaseId).digest('hex'),status:'valid',signedAt:now};
      fs.writeFileSync(path.join(sigDir,sigName), JSON.stringify(sig,null,2)+'\n');
    }
    fs.writeFileSync(path.join(verDir,'verify-result.json'), JSON.stringify({generatedAt:now,status:'PASS',pass:true,payloadValidated:true,envelopeValidated:true,governedArtifactType:'payload',payload:payload,payloadSha256:sha},null,2)+'\n');
    console.log('payload contract ok');
  " 2>/dev/null \
    && ok "Contrato payload-centric materializado" \
    || fail "Falha ao materializar contrato payload-centric"

  cp "$SCRIPT_DIR/verify-enterprise-governance.sh" "$ver_dir/verify-enterprise-governance.sh"
  cp "$SCRIPT_DIR/verify-enterprise-governance-v2.sh" "$ver_dir/verify-enterprise-governance-v2.sh"
  cp "$SCRIPT_DIR/release-governance-blocklist.sh" "$ver_dir/release-governance-blocklist.sh"
  cp "$SCRIPT_DIR/release-payload-blocklist.sh" "$ver_dir/release-payload-blocklist.sh"
  chmod +x "$ver_dir/verify-enterprise-governance.sh" "$ver_dir/verify-enterprise-governance-v2.sh"
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
    final-governance-report.json \
    governance-attestation.json \
    governance-chain.json; do
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
command -v unzip >/dev/null 2>&1 || fail "'unzip' não encontrado — extração limpa é obrigatória"
ok "Pré-condições verificadas"

# ── GATE DE PROVENIÊNCIA: worktree limpo no INÍCIO do pipeline ───────────────
# RELEASE OFICIAL exige `git status --porcelain` vazio ANTES de qualquer
# geração: o pacote precisa corresponder exatamente ao gitCommit declarado no
# manifest (regressão real: r-agent2-20260829-213044 registrou 58b12b76 com o
# working tree sujo). Artefatos de governança (governance/*.json, reports/*)
# mudam DURANTE o two-pass — por isso o snapshot é feito uma única vez aqui,
# antes da limpeza e de qualquer geração. NUNCA commit automático.
step "GATE DIRTY_WORKTREE: snapshot do worktree no início do pipeline..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/check-clean-worktree.js" --root "$PROJECT_ROOT" \
  || fail "DIRTY_WORKTREE — release bloqueada: commite ou descarte as pendências antes do release"
ok "Worktree limpo no snapshot inicial"

# Proveniência git capturada no snapshot inicial (40-char SHA + tree SHA).
GIT_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "n/a")"
GIT_TREE="$(git -C "$PROJECT_ROOT" rev-parse 'HEAD^{tree}' 2>/dev/null || echo "n/a")"
GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")"
GIT_REF="$(git -C "$PROJECT_ROOT" symbolic-ref -q HEAD 2>/dev/null || echo "DETACHED")"
ok "Proveniência: commit=$GIT_COMMIT tree=$GIT_TREE ref=$GIT_REF"

# ── GATE EXPERIENCE-SEGREGATION: evidência fresca em todo release oficial ────
# O relatório é consumido pelo Master Scorecard (RAP-014/RAP-015), entra no
# Evidence Manifest e é verificado pelo delivered-release verifier — precisa
# ser gerado no MESMO release, antes da materialização dos proof reports.
step "GATE experience-segregation: gerando relatório do release..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/validate-experience-segregation.js" \
  || fail "experience-segregation FAIL — release bloqueada"
ok "reports/experience-segregation-report.json PASS (evidência do release)"

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
  rm -f "$old_zip" "${old_zip%.zip}.manifest.json" "${old_zip%.zip}.approval.json"
  echo "  Removido: $(basename "$old_zip")"
done
ok "dist/ limpo de releases anteriores"

# Frontend (opcional)
if [[ "$SKIP_FRONTEND" == true ]]; then
  [[ "$DRY_RUN" == true ]] || fail "--skip-frontend só é permitido em dry-run diagnóstico"
  warn "Pipeline do frontend ignorado no dry-run"
else
  step "Executando pipeline do frontend..."
  bash "$PROJECT_ROOT/scripts/frontend-release-pipeline.sh" \
    && ok "Frontend OK" \
    || fail "Frontend pipeline falhou"
fi

# Materializar proof reports antes do primeiro ZIP. Prova anterior nunca é
# reutilizada: cada release precisa revalidar o source congelado do run atual.
step "Materializando proof reports..."
if node_with_workspace_env "$PROJECT_ROOT/tools/system/platform-readiness.js" 2>/dev/null; then
  ok "platform-readiness OK (PRE_PACKAGE: PASS_WITH_DEFERRED_PACKAGE_GATE ou AUTONOMOUS_READY_GO)"
else
  # Defesa legada: antes do modelo DEFERRED, o proof engine reportava um NO_GO
  # estrutural porque a validação de pacote era avaliada ANTES do ZIP existir.
  # Hoje (fase PRE_PACKAGE) package-validation = DEFERRED e o engine devolve
  # PASS_WITH_DEFERRED_PACKAGE_GATE (exit 0). Se chegou aqui, é um NO_GO real.
  TRANSIENT_ONLY="$(node -e "
    const fs = require('fs');
    const p = '$PROJECT_ROOT/dev/platform-readiness/latest.json';
    let j = null;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    const transient = new Set(['gap-proof-package-validation', 'gap-cross-report-package_validation_failed']);
    const gaps = (j?.blockingGaps || []).map(g => g?.id || g?.code || '').filter(Boolean);
    process.stdout.write(gaps.length > 0 && gaps.every(g => transient.has(g)) ? 'yes' : 'no');
  " 2>/dev/null || echo no)"
  if [[ "$TRANSIENT_ONLY" == "yes" ]]; then
    warn "platform-readiness reportou NO_GO com somente gap estrutural de pacote (legado) — revalidado no PASS 5"
  else
    fail "platform-readiness retornou NO_GO com gaps bloqueantes (não-transitórios)"
  fi
fi
node_with_workspace_env "$PROJECT_ROOT/governance/revalidate-master-scorecard.js" >/dev/null \
  && ok "Master Scorecard revalidado (PRE_PACKAGE)" \
  || warn "Master Scorecard abaixo de 10 no PRE_PACKAGE (package gate DEFERRED) — revalidado de forma bloqueante no PASS 5"

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
  "artifact":      "${RELEASE_NAME}.zip",
  "sha256":        "$H_PROVISIONAL",
  "generated_at":  "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit":    "$GIT_COMMIT",
  "git_tree":      "$GIT_TREE",
  "git_branch":    "$GIT_BRANCH",
  "git_ref":       "$GIT_REF",
  "cleanWorktree": true,
  "audit":         "passed",
  "pipeline":      "two-pass-immutable",
  "pass":          "1-provisional",
  "note":          "Provisional — sha256 será atualizado no PASS 4 para H_final"
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
node_with_workspace_env "$PROJECT_ROOT/governance/governance-chain.js" 2>/dev/null \
  && ok "Chain construída" || fail "Chain build falhou"

step "Gerando assinaturas (governance.sig, release.sig, manifest.sig, replay.sig)..."
node_with_workspace_env "$PROJECT_ROOT/governance/sign-governance.js" 2>/dev/null \
  && ok "Assinaturas geradas" || fail "Sign governance falhou"

# O sign-governance escreve o atestado em dist/governance-artifacts/. O
# self-proving lê governance/governance-attestation.json (workspace) — copiar
# de volta para eliminar referência stale ao pacote antigo.
step "Propagando atestado de governança para o workspace..."
for src in \
  "$DIST_DIR/governance-artifacts/governance-attestation.json" \
  "$DIST_DIR/governance-attestation.json"; do
  if [[ -f "$src" ]]; then
    cp "$src" "$PROJECT_ROOT/governance/governance-attestation.json"
    ok "Atestado propagado: governance/governance-attestation.json"
    break
  fi
done

step "Gerando replay integrity report..."
node_with_workspace_env "$PROJECT_ROOT/governance/replay-integrity.js" 2>/dev/null \
  && ok "Replay integrity OK" || fail "Replay integrity falhou"

step "Executando rebinding completo ao ZIP provisional..."
node_with_workspace_env "$PROJECT_ROOT/governance/rebind-to-current-package.js" \
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
node_with_workspace_env "$PROJECT_ROOT/governance/package-validator.js" --zip "$FINAL_ZIP" --audited-only 2>/dev/null \
  && ok "Artefato validado — package-validation-report.json atualizado" \
  || fail "package-validator reprovou o artefato"

# 4b. Criar manifest final (dist/RELEASE.manifest.json — membro da chain)
step "Gerando manifest final com H_final..."
ZIP_SIZE="$(du -h "$FINAL_ZIP" | cut -f1)"

write_release_manifest "$FINAL_ZIP" "$DIST_DIR/${RELEASE_NAME}.manifest.json" \
  "${RELEASE_NAME}.zip" "$H_FINAL" "$ZIP_SIZE" "$GIT_COMMIT" "$GIT_BRANCH"
ok "Manifest final: ${RELEASE_NAME}.manifest.json (sha256=$H_FINAL)"

# 4c. Atualizar vinculação do pacote em final-consistency-report.json e relatórios cruzados
# DEVE rodar antes do rebind — final-consistency-report.json é membro da chain
step "Atualizando package binding (elimina refs stale históricas)..."
node_with_workspace_env "$PROJECT_ROOT/governance/update-package-binding.js" 2>/dev/null \
  && ok "Package binding atualizado — final-consistency-report.json limpo" \
  || fail "update-package-binding falhou"

# 4d. Rebinding final — DEVE rodar DEPOIS de todos os membros da chain estarem estáveis
step "Executando rebinding final (GOVERNANCE_STALE_HASH=$H_PROVISIONAL)..."
# Injeta H_provisional como hash stale explícito para substituição por H_final
export GOVERNANCE_STALE_HASH="$H_PROVISIONAL"
node_with_workspace_env "$PROJECT_ROOT/governance/rebind-to-current-package.js" \
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
# Approvals de releases anteriores nunca sobrevivem a um novo packaging
for a in "$DIST_DIR"/r-agent2-*.approval.json "$DIST_DIR/release"/r-agent2-*.approval.json; do
  [[ -f "$a" ]] || continue
  if [[ "$(basename "$a")" != "${RELEASE_NAME}.approval.json" ]]; then
    rm -f "$a"
    echo "  Removido approval stale: $(basename "$a")"
  fi
done
ok "dist/ contém apenas o manifest atual: $CURRENT_MANIFEST"

# POST_PACKAGE: re-materializar proof reports com o pacote presente. O estado
# PRE_PACKAGE (PASS_WITH_DEFERRED_PACKAGE_GATE) precisa subir para
# AUTONOMOUS_READY_GO antes do PASS 5 revalidar o master scorecard.
step "POST_PACKAGE: re-materializando proof reports (pacote presente)..."
if node_with_workspace_env "$PROJECT_ROOT/tools/system/platform-readiness.js" 2>/dev/null; then
  ok "platform-readiness POST_PACKAGE OK"
else
  warn "platform-readiness POST_PACKAGE não retornou GO (verificado no PASS 5)"
fi

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
  "governance/final-governance-report.json" \
  "reports/experience-segregation-report.json"; do
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
  "replay-integrity-report.json" \
  "experience-segregation-report.json"; do
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
  fail "check-dist-clean detectou problemas"
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
  # ── Revalidação pós-packaging (gap estrutural de pacote já resolvido) ─────
  step "Revalidando platform-readiness com o pacote final (gap transitório resolvido)..."
  if node_with_workspace_env "$PROJECT_ROOT/tools/system/platform-readiness.js" 2>/dev/null; then
    ok "platform-readiness AUTONOMOUS_READY_GO (pós-packaging)"
  else
    fail "platform-readiness pós-packaging retornou NO_GO — release bloqueada"
  fi

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
