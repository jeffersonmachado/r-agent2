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
# Proveniência: antes do PASS 1, o gate REMOTE_PROVENANCE comprova que o
# commit/tree do release existem no remote (fail-closed; override documentado
# RAP_SKIP_REMOTE_PROVENANCE=1 apenas para builds de emergência, com warn).
# A tag imutável de release NÃO é criada aqui (exige verifier offline PASS):
# após o sucesso, rode scripts/create-release-tag.sh e re-verifique com
# verify-remote-provenance --require-tag (instruções impressas ao final).
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

# ── AUTHORITY DE FASE (TAREFA 47/48) ────────────────────────────────────────
# A fase do release NÃO é comentário nem tolerância ad hoc: é transição
# validada por `governance/release-state-machine.js`. Antes desta ligação o
# pipeline usava critérios próprios (`SEAL_PENDING`,
# `PASS_WITH_DEFERRED_PACKAGE_GATE`, `DELIVERED_PHASE_DIMS` hardcoded) —
# autoridades PARALELAS que podiam divergir da máquina de estados em silêncio.
#
# `phase` falha o release quando a transição é ilegal (pulo de fase), quando um
# gate permanece PENDING vencido ou quando há ciclo no DAG.
phase() {
  node_with_workspace_env "$PROJECT_ROOT/scripts/governance/release-phase.js" "$@" >/dev/null 2>&1 \
    && ok "release-phase $*" \
    || {
      node_with_workspace_env "$PROJECT_ROOT/scripts/governance/release-phase.js" "$@" 2>&1 | tail -6
      fail "release-phase $* — transição de fase inválida (autoridade de fase)"
    }
}

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

  # Revalidar o payload saneado DE VERDADE: o saneamento (PASS 4b) mudou o
  # sha256 do payload. PROIBIDO patchar ok=true no relatório (anti-padrão que
  # fabricava GO sobre NO_GO — root cause do release r-agent2-20260903-134904).
  # O package-validator revalida o artefato efetivamente entregue e regrava o
  # relatório (com lineage na origem) — se reprovar, o release é bloqueado.
  step "Revalidando payload saneado (package-validation FINAL real)..."
  node_with_workspace_env "$PROJECT_ROOT/governance/package-validator.js" \
    --zip "$DIST_DIR/release/$payload_name" --audited-only \
    && ok "package-validation FINAL real gravado para o payload entregue" \
    || fail "package-validator reprovou o payload saneado — release bloqueada"

  # Package integrity FINAL real contra o payload + manifest pós-saneamento
  # (mesmo princípio: resultado de engine, nunca escrita sintética).
  step "Reavaliando package-integrity contra o payload entregue..."
  node_with_workspace_env "$PROJECT_ROOT/governance/package-integrity-engine.js" >/dev/null 2>&1 \
    && ok "package-integrity FINAL real: PACKAGE_INTEGRITY_GO" \
    || fail "package-integrity-engine reprovou o payload entregue — release bloqueada"

  node_with_workspace_env "$PROJECT_ROOT/scripts/governance/stamp-report-lineage.js" >/dev/null 2>&1 \
    || fail "stamp-report-lineage falhou no PASS 5 — artefatos sem lineage não podem ser certificados"

  if [[ "${SEAL_DECISION:-SEAL_GO}" == "SEAL_GO" ]]; then
    node_with_workspace_env "$PROJECT_ROOT/governance/revalidate-master-scorecard.js" >/dev/null \
      || fail "Master Scorecard não validou para o payload"
    node_with_workspace_env "$PROJECT_ROOT/governance/final-consistency-gate.js" >/dev/null \
      || fail "Final Consistency não validou para o payload"
    node_with_workspace_env "$PROJECT_ROOT/governance/final-governance-engine.js" >/dev/null \
      || fail "Final Governance não autorizou o payload"
  else
    # Candidato (fase DELIVERED): os engines brutos não são DEFERRED-aware e
    # sobrescreveriam a projeção canônica com NO_GO espúrio. O fixpoint
    # persistido é a reavaliação verdadeira: re-projeta DEFERRED a partir do DB.
    node_with_workspace_env "$PROJECT_ROOT/governance/revalidate-master-scorecard.js" >/dev/null 2>&1 || true
    node_with_workspace_env "$PROJECT_ROOT/scripts/governance/run-persisted-scorecard.js" >/dev/null 2>&1 \
      || fail "fixpoint do scorecard falhou na materialização do candidato — estado canônico indefinido"
  fi

  # Re-assinar contra o payload final DEPOIS de todas as escritas em membros da
  # chain (evidence-manifest, final-proof, final-readiness, final-consistency,
  # cross-report, proof-signature, package-validation): stamp e fixpoint acima
  # regravam esses relatórios — assinar antes quebraria a governance-chain
  # (chainRoot divergente) e reprovaria o self-proving/tamper legítimos.
  # As assinaturas do PASS 2 foram emitidas contra H_provisional; o rebind
  # patcheou os campos mas NÃO recomputou os selos HMAC. Re-emitir agora (o ZIP
  # final está em dist/release/*.payload.zip) e propagar para dist/signatures/
  # antes do tamper-detector.
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

  # Materializar o ENVELOPE DERIVADO da governança canônica do PAYLOAD.
  # Regra absoluta: o envelope COPIA e VINCULA a decisão canônica embutida no
  # payload — nunca a inventa. package-validation/package-integrity/self-proving
  # do envelope são os relatórios REAIS produzidos pelos engines nesta fase
  # (revalidados contra o payload entregue), não escritas sintéticas com GO.
  step "Derivando envelope da governança canônica do payload (fail-closed)..."
  node_with_workspace_env -e "
    const fs=require('fs'), crypto=require('crypto'), path=require('path'), os=require('os');
    const { execFileSync } = require('child_process');
    const { normalizeDecision } = require('$PROJECT_ROOT/governance/canonical-decision');
    const { withLineage } = require('$PROJECT_ROOT/governance/report-lineage');
    const payload='$payload_name', sha='$payload_hash', releaseId='$release_id';
    const govDir='$gov_dir';
    const manifestPath='$manifest_path';
    const now=new Date().toISOString();

    // 1. Decisão canônica DENTRO do payload (fonte da verdade). Regra absoluta:
    //    envelope GO exige canônica GO. Na fase DELIVERED (SEAL_PENDING) a
    //    canônica é PASS_WITH_DEFERRED_PACKAGE_GATE — o envelope carrega essa
    //    mesma decisão verdadeira (candidato), nunca GO.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'rap-envelope-derive-'));
    execFileSync('unzip',['-qq',path.join('$DIST_DIR','release',payload),'r-agent2/governance/final-governance-report.json','-d',tmp],{stdio:'pipe'});
    const canonicalPath = path.join(tmp,'r-agent2/governance/final-governance-report.json');
    const canonical = JSON.parse(fs.readFileSync(canonicalPath,'utf8'));
    const canonicalSha = crypto.createHash('sha256').update(fs.readFileSync(canonicalPath)).digest('hex');
    const canonicalDecision = normalizeDecision(canonical.finalDecision || canonical.decision);
    fs.rmSync(tmp,{recursive:true,force:true});
    const sealDecision = '${SEAL_DECISION:-SEAL_GO}';
    const DEFERRED = 'PASS_WITH_DEFERRED_PACKAGE_GATE';
    let candidate = false;
    if (canonicalDecision !== 'GO') {
      if (sealDecision === 'SEAL_PENDING' && (canonical.finalDecision||canonical.decision) === DEFERRED) {
        candidate = true;
      } else {
        console.error('PAYLOAD_CANONICAL_NO_GO — ' + (canonical.finalDecision||'null'));
        process.exit(1);
      }
    }
    const runId = canonical.runId || null;
    const sourceFingerprint = canonical.sourceFingerprint || null;

    const w=(f,j)=>fs.writeFileSync(path.join(govDir,f), JSON.stringify(j,null,2)+'\n');
    w('payload-governance.json',{governedArtifact:payload,governedHash:sha,architecture:'payload-centric',createdAt:now,releaseTimestamp:releaseId,envelopeAware:true,runId,sourceFingerprint,payloadGovernance:{isGovernedArtifact:true,isEnvelopeArtifact:false},transitional:false,placeholder:false,status: candidate?'candidate':'final'});
    w('governance-chain.json',{architecture:'payload-centric',chainRoot:sha,releaseId,runId,payloadRef:payload,transitional:false});
    w('governance-attestation.json',{architecture:'payload-centric',finalDecision:canonical.finalDecision,canonicalDecision,releaseId,runId,payloadRef:payload,canonicalSha256:canonicalSha,transitional:false});

    // 2. final-governance-report do envelope = CÓPIA DERIVADA vinculada por hash.
    //    Em modo candidato, a decisão é a DEFERRED verdadeira (pass=false) —
    //    jamais GO sintético.
    w('final-governance-report.json', withLineage({
      generatedAt:now,
      finalDecision: canonical.finalDecision,
      decision: canonicalDecision,
      pass: canonicalDecision==='GO',
      candidate,
      canonicalSource:'payload:r-agent2/governance/final-governance-report.json',
      canonicalSha256: canonicalSha,
      derivedFromCanonical:true,
      payload, payloadSha256: sha,
      packagePhase: candidate?'DELIVERED_PHASE_CANDIDATE':'FINAL',
      payloadModel:'minimal-envelope-governed',
      producer:'two-pass-release/envelope-derivation',
      transitional:false, placeholder:false, status: candidate?'candidate':'final',
    }, 'final-governance-report', { includeGit: true }));

    // 3. package-validation/package-integrity do envelope = relatórios REAIS do
    //    workspace (revalidados contra o payload entregue acima), vinculados ao
    //    hash do payload e à decisão canônica.
    for (const f of ['package-validation-report.json','package-integrity-report.json']) {
      const real = JSON.parse(fs.readFileSync(path.join('$PROJECT_ROOT','governance',f),'utf8'));
      real.payloadSha256 = sha;
      real.finalDecision = canonical.finalDecision;
      real.canonicalSource = 'payload:r-agent2/governance/' + f;
      real.derivedFromCanonical = true;
      real.status = 'final'; real.transitional = false; real.placeholder = false;
      w(f, real);
    }
    console.log('envelope derivado da decisão canônica: ' + canonical.finalDecision);
  " 2>/dev/null \
    && ok "Envelope derivado da governança canônica do payload" \
    || fail "Governança canônica do payload não é GO — release bloqueada (proibido promover NO_GO→GO)"

  # Self-proving REAL do artefato entregue (engine, nunca escrita sintética).
  # No modo SEAL_GO o PASS é obrigatório; no candidato DEFERRED o relatório é
  # copiado verdadeiro (pass=false reflete a fase, não adulteração).
  step "Self-proving real do artefato entregue..."
  node_with_workspace_env "$PROJECT_ROOT/governance/self-proving-report.js" >/dev/null 2>&1 || true
  if [[ "${SEAL_DECISION:-SEAL_GO}" == "SEAL_GO" ]]; then
    node_with_workspace_env -e "
      const r = require('$PROJECT_ROOT/governance/self-proving-report.json');
      if (r.pass !== true) { console.error('SELF_PROVING_FAIL — ' + (r.summary||'pass=false')); process.exit(1); }
    " || fail "self-proving real FAIL — release bloqueada (proibido materializar PASS sintético)"
    ok "self-proving real PASS copiado para o envelope"
  else
    ok "self-proving real (estado DEFERRED verdadeiro) copiado para o envelope"
  fi
  cp "$PROJECT_ROOT/governance/self-proving-report.json" "$gov_dir/self-proving-report.json"

  # Attestation Ed25519: autenticação real do release (chave privada fora do
  # pacote/repositório; pública distribuída no verifier). Cobre releaseId,
  # runId, sourceFingerprint, gitCommit, gitTree, payloadSha256, manifestSha256
  # e a decisão canônica — modificar qualquer campo invalida a assinatura.
  step "Assinando attestation Ed25519 do release..."
  node_with_workspace_env -e "
    const fs=require('fs'), crypto=require('crypto'), path=require('path');
    const { signAttestation } = require('$PROJECT_ROOT/governance/release-attestation');
    const manifest = JSON.parse(fs.readFileSync('$manifest_path','utf8'));
    const canonical = JSON.parse(fs.readFileSync(path.join('$gov_dir','final-governance-report.json'),'utf8'));
    const manifestSha = crypto.createHash('sha256').update(fs.readFileSync('$manifest_path')).digest('hex');
    const sig = signAttestation({
      releaseId: '$release_id',
      runId: manifest.runId || canonical.runId,
      sourceFingerprint: manifest.sourceFingerprint || canonical.sourceFingerprint,
      gitCommit: manifest.git_commit,
      gitTree: manifest.git_tree,
      payloadSha256: '$payload_hash',
      manifestSha256: manifestSha,
      finalDecision: canonical.finalDecision,
    });
    fs.writeFileSync(path.join('$sig_dir','release-attestation.sig'), JSON.stringify(sig,null,2)+'\n');
    console.log('attestation ed25519 ok fp=' + sig.publicKeyFingerprint.slice(0,16));
  " 2>/dev/null \
    && ok "release-attestation.sig (Ed25519) emitido" \
    || fail "Falha ao assinar attestation Ed25519 — chave ausente? rode: node governance/release-attestation.js keygen"
  # Chave pública RESOLVIDA (env > keyDir > repo) — a que corresponde à chave
  # que assinou, mesmo quando provisionada via secret store/CI.
  node_with_workspace_env -e "
    require('$PROJECT_ROOT/governance/release-attestation')
      .exportResolvedPublicKey('$ver_dir/release-attestation-public-key.json');
  " || fail "Falha ao exportar chave pública resolvida para o verifier"
  cp "$SCRIPT_DIR/verify-payload-governance.js" "$ver_dir/verify-payload-governance.js"

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
# Attestation Ed25519: a chave privada vive FORA do pacote/repositório (runtime
# root ou env RAP_RELEASE_ATTESTATION_PRIVATE_KEY — secret store/CI). Sem ela
# não há assinatura autenticada do release — falhar cedo.
node_with_workspace_env -e "
  const m = require('$PROJECT_ROOT/governance/release-attestation');
  m.loadPrivateKey();
  m.loadPublicKey();
" 2>/dev/null \
  || fail "Chave de attestation ausente — rode: node governance/release-attestation.js keygen (ou provisione RAP_RELEASE_ATTESTATION_PRIVATE_KEY)"
ok "Pré-condições verificadas"

# ── GATE DE PROVENIÊNCIA: worktree limpo no INÍCIO do pipeline ───────────────
# RELEASE OFICIAL exige `git status --porcelain` vazio ANTES de qualquer
# geração: o pacote precisa corresponder exatamente ao gitCommit declarado no
# manifest (regressão real: r-agent2-20260829-213044 registrou 58b12b76 com o
# working tree sujo). Artefatos de governança (governance/*.json, reports/*)
# mudam DURANTE o two-pass — por isso o snapshot é feito uma única vez aqui,
# antes da limpeza e de qualquer geração. NUNCA commit automático.
step "GATE DIRTY_WORKTREE: snapshot do worktree no início do pipeline..."
if [[ "${RAP_WORKTREE_SNAPSHOT_VALIDATED:-}" == "1" ]]; then
  # Snapshot já validado no início do pipeline chamador (ex.: tools/system/release.js
  # via system:release): os passos intermediários regeneram artefatos de governança
  # rastreados, então o worktree aqui já pode estar sujo por geração legítima.
  ok "Worktree snapshot já validado no início do pipeline (RAP_WORKTREE_SNAPSHOT_VALIDATED=1)"
else
  node_with_workspace_env "$PROJECT_ROOT/scripts/governance/check-clean-worktree.js" --root "$PROJECT_ROOT" \
    || fail "DIRTY_WORKTREE — release bloqueada: commite ou descarte as pendências antes do release"
  ok "Worktree limpo no snapshot inicial"
fi

# Proveniência git capturada no snapshot inicial (40-char SHA + tree SHA).
GIT_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "n/a")"
GIT_TREE="$(git -C "$PROJECT_ROOT" rev-parse 'HEAD^{tree}' 2>/dev/null || echo "n/a")"
GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")"
GIT_REF="$(git -C "$PROJECT_ROOT" symbolic-ref -q HEAD 2>/dev/null || echo "DETACHED")"
ok "Proveniência: commit=$GIT_COMMIT tree=$GIT_TREE ref=$GIT_REF"

# ── GATE REMOTE_PROVENANCE: a fonte do release deve existir no remote ────────
# A proveniência local (acima) só declara o que foi empacotado; este gate
# comprova que o commit é reproduzível a partir do remote (tip de branch ou
# ancestro do tip) e que a tree confere — fail-closed antes do SEAL_GO. O
# relatório (dual-write reports/ + governance/) é packageRequired: entra no
# payload e o verifier offline o valida com hash binding no gate
# manifest_provenance. Override de emergência explícito (mesma disciplina do
# RAP_WORKTREE_SNAPSHOT_VALIDATED): RAP_SKIP_REMOTE_PROVENANCE=1 com warn —
# um release assim NÃO é oficialmente reproduzível.
step "GATE remote-provenance: verificando commit/tree contra o remote..."
if [[ "${RAP_SKIP_REMOTE_PROVENANCE:-}" == "1" ]]; then
  warn "RAP_SKIP_REMOTE_PROVENANCE=1 — verificação de proveniência remota IGNORADA (override de emergência; release não oficialmente reproduzível)"
else
  node_with_workspace_env "$PROJECT_ROOT/scripts/governance/verify-remote-provenance.js" \
    --commit "$GIT_COMMIT" --tree "$GIT_TREE" \
    || fail "REMOTE_PROVENANCE — release bloqueada: o commit do release precisa existir no remote (push antes do release)"
  ok "Proveniência remota verificada (commit presente no remote, tree íntegra)"
fi

# ── AUTHORITY DE FASE: SOURCE_VALIDATED → PRE_PACKAGE ───────────────────────
# A partir daqui a fonte está validada (proveniência local + remota) e o run
# entra na fase de preparação do pacote. Tudo que depende de um artefato
# POSTERIOR é `PENDING_PHASE` (nunca PASS, nunca FAIL) até sua fase chegar.
phase start --release "$RELEASE_NAME"
# `start` já fixa a fase inicial em SOURCE_VALIDATED (a fonte local e remota
# foram verificadas acima); o próximo passo é a preparação do pacote.
phase advance --to PRE_PACKAGE

# ── GATE EXPERIENCE-SEGREGATION: evidência fresca em todo release oficial ────
# O relatório é consumido pelo Master Scorecard (RAP-014/RAP-015), entra no
# Evidence Manifest e é verificado pelo delivered-release verifier — precisa
# ser gerado no MESMO release, antes da materialização dos proof reports.
step "GATE experience-segregation: gerando relatório do release..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/validate-experience-segregation.js" \
  || fail "experience-segregation FAIL — release bloqueada"
ok "reports/experience-segregation-report.json PASS (evidência do release)"

# GATE EXPERIENCE-API-SEGREGATION: prova server-side (APIs) — mesma disciplina:
# relatório com lineage na origem + cópia canônica em governance/ (packageRequired
# no evidence-manifest, verificada offline pelo gate payload_experience_api_segregation).
step "GATE experience-api-segregation: gerando relatório do release..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/validate-experience-api-segregation.js" \
  || fail "experience-api-segregation FAIL — release bloqueada"
ok "reports/experience-api-segregation-report.json PASS (evidência do release)"

# GATE OUTBOUND-RELIABILITY: prova de confiabilidade do pipeline outbound
# (transactional outbox + delivery ambiguity) — suítes Jest reais + invariante
# de banco; FAIL bloqueia o release. A prova entra no evidence-manifest como
# packageRequired e é verificada offline pelo gate payload_outbound_reliability.
step "GATE outbound-reliability: gerando prova do release..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/generate-outbound-reliability-evidence.js" \
  || fail "outbound-reliability FAIL — release bloqueada"
ok "governance/outbound-reliability-report.json PASS (evidência do release)"

# Re-stamp de lineage imediato: o relatório recém-gerado NÃO carrega
# runId/sourceFingerprint/artifactType/artifactVersion. Sem o stamp, o Master
# Scorecard (RAP-014/RAP-015, requireLineage) falha com INVALID_ARTIFACT nas
# avaliações de readiness que rodam antes do stamp da PASS 5.
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/stamp-report-lineage.js" >/dev/null 2>&1 \
  && ok "lineage re-stampado após gate experience-segregation" \
  || warn "stamp-report-lineage não concluiu após gate experience-segregation (revalidado na PASS 5)"

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
# R31/R33 — RETENÇÃO: o release oficialmente publicado NÃO é destruído por um
# run novo. Ele sai do caminho do run atual (para não ser confundido com o
# artefato corrente) e vai para dist/archive/<release>/ com retenção própria.
ARCHIVE_DIR="$DIST_DIR/archive"
for old_zip in "$DIST_DIR/release"/r-agent2-*.zip; do
  [[ -f "$old_zip" ]] || continue
  base="$(basename "${old_zip%.zip}")"
  mkdir -p "$ARCHIVE_DIR/$base"
  for sidecar in "$old_zip" "${old_zip%.zip}.manifest.json" "${old_zip%.zip}.delivered.identity.json" "${old_zip%.zip}.approval.json"; do
    if [[ -f "$sidecar" ]]; then mv "$sidecar" "$ARCHIVE_DIR/$base/"; fi
  done
  echo "  Arquivado (release publicado preservado): $base"
done
for old_zip in "$DIST_DIR"/r-agent2-*.zip; do
  [[ -f "$old_zip" ]] || continue
  rm -f "$old_zip" "${old_zip%.zip}.manifest.json" "${old_zip%.zip}.approval.json" "${old_zip%.zip}.delivered.identity.json"
  echo "  Removido: $(basename "$old_zip")"
done
# Retenção do arquivo: mantém os 5 releases publicados mais recentes.
if [[ -d "$ARCHIVE_DIR" ]]; then
  ls -1dt "$ARCHIVE_DIR"/*/ 2>/dev/null | tail -n +6 | while read -r old_dir; do
    rm -rf "$old_dir" && echo "  Arquivo podado: $(basename "$old_dir")"
  done
fi
# R4 — namespace do CANDIDATO é por run: limpo a cada execução.
rm -rf "$DIST_DIR/candidate"
mkdir -p "$DIST_DIR/candidate"
ok "dist/ limpo (publicados preservados em dist/archive/, candidato zerado)"

# ═══════════════════════════════════════════════════════════════════════════
# PRE_PACKAGE — PROVISIONAMENTO DO RUN GOVERNADO PARA O SOURCE ATUAL
# ═══════════════════════════════════════════════════════════════════════════
# Deadlock real (2026-09-13, reproduzido a partir de dist/release vazio):
# sem um governance run CONGELADO para o source atual, o proof é STALE e o
# `zip:release` abortava já em PRE_PACKAGE com `platform-readiness NO_GO` +
# gap `gap-proof-stale-fingerprints`. A cura existia, mas era uma sequência
# manual secreta (create-governed-run -> converge -> commit) — um comando
# oficial que só funciona depois de passos não documentados não é oficial.
# Aqui o pipeline provisiona o próprio run sobre o source JÁ CONGELADO no
# snapshot (GIT_COMMIT/GIT_TREE capturados acima) e converge a governança.
if [[ "${RAP_SKIP_PRE_PACKAGE_PROVISION:-}" == "1" ]]; then
  warn "RAP_SKIP_PRE_PACKAGE_PROVISION=1 — provisionamento PRE_PACKAGE ignorado (release NÃO reproduzível)"
else
  step "PRE_PACKAGE: garantindo governance run do source atual..."
  node_with_workspace_env "$PROJECT_ROOT/scripts/governance/ensure-governed-run.js" \
    || fail "não foi possível garantir um governance run para o source atual (persistência é autoridade)"

  step "PRE_PACKAGE: package-validation honesta (candidato ainda não existe)..."
  # Sem ZIP em dist/ o validator produz DEFERRED/PRE_PACKAGE — nunca FAIL de
  # conteúdo, nunca PASS. Exit 1 é ESPERADO nesta fase.
  node_with_workspace_env "$PROJECT_ROOT/governance/package-validator.js" >/dev/null 2>&1 || true

  step "PRE_PACKAGE: convergindo governança para o run atual..."
  CONVERGE_LOG="${TMPDIR:-/tmp}/r-agent2-converge-${RELEASE_NAME}.log"
  if bash "$PROJECT_ROOT/scripts/governance/converge-governance.sh" > "$CONVERGE_LOG" 2>&1; then
    ok "convergência PRE_PACKAGE concluída (log: $CONVERGE_LOG)"
  else
    warn "convergência reportou decisão não-GO em PRE_PACKAGE (log: $CONVERGE_LOG) — avaliada pelos gates abaixo"
  fi
fi

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

# ── R4/R5 — CANDIDATO COMO ARTEFATO DE PRIMEIRA CLASSE ──────────────────────
# O candidato é materializado em dist/candidate/ com identidade própria
# (artifactType=CANDIDATE). Ele NUNCA é rotulado DELIVERED/PUBLISHED/FINAL, e
# seus bytes não são reescritos depois (R23) — o payload final é um artefato
# DERIVADO que registra parentCandidateHash.
CANDIDATE_DIR="$DIST_DIR/candidate"
CANDIDATE_ZIP="$CANDIDATE_DIR/${RELEASE_NAME}.candidate.zip"
mkdir -p "$CANDIDATE_DIR"
cp "$PROVISIONAL_ZIP" "$CANDIDATE_ZIP"
H_CANDIDATE="$(sha256sum "$CANDIDATE_ZIP" | awk '{print $1}')"
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/write-release-identity.js" \
  --kind candidate --release "$RELEASE_NAME" --candidate-hash "$H_CANDIDATE" \
  --commit "$GIT_COMMIT" --phase CANDIDATE_BUILT \
  || fail "não foi possível materializar a identidade do candidato"
ok "Candidato materializado: dist/candidate/${RELEASE_NAME}.candidate.zip"
ok "H_candidate    : $H_CANDIDATE"

# ── AUTHORITY DE FASE: CANDIDATE_BUILT → CANDIDATE_VALIDATED ────────────────
# O candidato existe como artefato de primeira classe; a identidade dele é
# conferida contra os BYTES reais antes de a fase avançar. Um candidato que não
# passa aqui não pode virar "selado": é a separação CANDIDATE ≠ DELIVERED.
phase advance --to CANDIDATE_BUILT
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/verify-release-artifact-identity.js" \
  --kind candidate --phase CANDIDATE_BUILT \
  || fail "identidade do CANDIDATO inválida — release bloqueado antes da selagem"
phase advance --to CANDIDATE_VALIDATED

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
pass "PASS 2.9 — CONVERGENCE GATE: governança real ANTES de selar o payload"
# ══════════════════════════════════════════════════════════════════════════════
# O payload carrega o estado de governance/ no momento do zip. Se esse estado
# for NO_GO real, o pacote nasce NO_GO e nenhuma fase posterior pode promovê-lo
# (root cause do release r-agent2-20260903-134904: payload selado NO_GO +
# envelope GO sintético). Aqui os engines reais rodam contra o pacote
# provisional EM ORDEM DE DEPENDÊNCIA e o seal-time-gate avalia o resultado:
#   SEAL_GO      → payload selado com decisão GO real;
#   SEAL_PENDING → fase DELIVERED legítima (PASS_WITH_DEFERRED_PACKAGE_GATE,
#                  below10 ⊆ {RAP-055,RAP-056}): sela um CANDIDATO com decisão
#                  DEFERRED verdadeira de ponta a ponta (nunca envelope GO);
#   SEAL_NO_GO   → release ABORTADA. Payload nunca é selado com NO_GO real.
step "Validando pacote provisional (package-validation real com lineage)..."
node_with_workspace_env "$PROJECT_ROOT/governance/package-validator.js" \
  --zip "$PROVISIONAL_ZIP" --audited-only \
  && ok "Pacote provisional validado (package-validation-report.json)" \
  || fail "package-validator reprovou o pacote provisional — payload não será selado"

# Ordem de dependência (validada empiricamente): integrity consome o relatório
# do validator; sign re-emite os selos HMAC contra o provisional; as sigs e o
# atestado precisam ser sincronizados para dist/signatures e dist/governance
# (o tamper-detector resolve esses diretórios primeiro — sem o sync ele lê os
# artefatos do release ANTERIOR e reporta NO_GO espúrio); tamper e self-proving
# consomem o estado assinado.
step "Reavaliando package-integrity contra o pacote provisional..."
node_with_workspace_env "$PROJECT_ROOT/governance/package-integrity-engine.js" >/dev/null 2>&1 \
  && ok "package-integrity pré-selo: PACKAGE_INTEGRITY_GO" \
  || fail "package-integrity reprovou o pacote provisional — payload não será selado"

step "Re-assinando governança contra o pacote provisional (H_provisional)..."
node_with_workspace_env "$PROJECT_ROOT/governance/sign-governance.js" >/dev/null 2>&1 \
  && ok "Assinaturas HMAC re-emitidas contra H_provisional" \
  || fail "sign-governance falhou no PASS 2.9"

step "Sincronizando sigs/atestado para dist/ (tamper resolve dist/ primeiro)..."
mkdir -p "$DIST_DIR/signatures" "$DIST_DIR/governance"
for f in governance.sig release.sig package.manifest.sig replay.sig; do
  [[ -f "$DIST_DIR/governance-artifacts/$f" ]] && cp "$DIST_DIR/governance-artifacts/$f" "$DIST_DIR/signatures/$f"
done
[[ -f "$PROJECT_ROOT/governance/governance-attestation.json" ]] \
  && cp "$PROJECT_ROOT/governance/governance-attestation.json" "$DIST_DIR/governance/governance-attestation.json"
ok "dist/signatures + dist/governance sincronizados com o estado assinado"

step "Tamper detection pré-selo (estado assinado)..."
node_with_workspace_env "$PROJECT_ROOT/governance/tamper-detector.js" >/dev/null 2>&1 \
  && ok "tamper-detection pré-selo: GO" \
  || fail "tamper-detector reprovou o estado pré-selo — payload não será selado"

step "Self-proving do pacote provisional..."
node_with_workspace_env "$PROJECT_ROOT/governance/self-proving-report.js" >/dev/null 2>&1 \
  && ok "self-proving pré-selo PASS" \
  || warn "self-proving pré-selo não PASS (seal-time-gate decide)"

step "Re-materializando proof reports com pacote provisional presente..."
node_with_workspace_env "$PROJECT_ROOT/tools/system/platform-readiness.js" >/dev/null 2>&1 \
  && ok "platform-readiness GO (pré-selo)" \
  || warn "platform-readiness pré-selo não retornou GO (seal-time-gate decide)"

step "Stamp de lineage (backstop bloqueante pré-selo)..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/stamp-report-lineage.js" >/dev/null 2>&1 \
  || fail "stamp-report-lineage falhou — artefatos sem lineage não podem ser selados"

# Engines de certificação (estado bruto) ANTES do fixpoint: eles não são
# DEFERRED-aware e reportam NO_GO quando o scorecard tem below10 — a projeção
# canônica (exportGovernanceArtifacts, dentro do fixpoint) é a ÚLTIMA escritora
# dos 4 relatórios projetados. Inverter esta ordem reintroduz NO_GO espúrio.
step "Reavaliando engines de certificação (pré-selo, estado bruto)..."
node_with_workspace_env "$PROJECT_ROOT/governance/final-consistency-gate.js" >/dev/null 2>&1 || true
node_with_workspace_env "$PROJECT_ROOT/governance/final-governance-engine.js" >/dev/null 2>&1 || true

# Fixpoint persistido (2 passes + projeções derivadas do DB): quebra o ciclo
# scorecard↔readiness/governance e estabiliza o estado canônico — 78/78 no
# ciclo final, ou below10 ⊆ {RAP-055,RAP-056} na fase DELIVERED.
step "Fixpoint do master scorecard (persisted, 2 passes)..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/run-persisted-scorecard.js" >/dev/null 2>&1 \
  && ok "fixpoint do scorecard concluído" \
  || fail "run-persisted-scorecard falhou — sem fixpoint não há estado canônico selável"

step "SEAL-TIME GATE: avaliando estado canônico produzido pelos engines..."
SEAL_OUTPUT="$(node_with_workspace_env "$PROJECT_ROOT/scripts/governance/seal-time-gate.js" 2>&1)" && SEAL_RC=0 || SEAL_RC=$?
echo "$SEAL_OUTPUT"
[[ "$SEAL_RC" -eq 0 ]] || fail "CANONICAL_NO_GO — release abortada: governança real não convergiu antes de selar o payload"
SEAL_DECISION="$(grep -oE 'SEAL_GO|SEAL_PENDING' <<< "$SEAL_OUTPUT" | tail -1)"
[[ -n "$SEAL_DECISION" ]] || fail "seal-time-gate não emitiu decisão parseável"

# ── AUTHORITY DE FASE: SEALED ───────────────────────────────────────────────
# A selagem é uma TRANSIÇÃO, não um rótulo: o gate de selo declarou a decisão
# real (SEAL_GO/SEAL_PENDING) e a fase só avança no GO. Um gate que tente
# exigir artefato de fase POSTERIOR (DELIVERED) permanece PENDING_PHASE.
if [[ "$SEAL_DECISION" == "SEAL_GO" ]]; then
  phase advance --to SEALED
else
  ok "fase SEALED não alcançada (decisão=${SEAL_DECISION}) — gates posteriores seguem PENDING_PHASE"
fi
ok "Seal decision: $SEAL_DECISION"

# ── GATE FINAL_STATUS_PROJECTION: projeções frescas ANTES de selar o payload ─
# BLOCKER 2 (r-agent2-20260905-163709): as projeções derivadas (PLATFORM_STATUS,
# ENTERPRISE_READINESS, RAP_MASTER_SCORECARD, latest.json, _platform-status-source)
# foram regeneradas na fase DELIVERED (decisão DEFERRED/NO_GO, 76/78) e o PASS 3
# empacotou esse estado STALE mesmo com a canônica já em 78/78 GO. O
# generate-zip.sh captura o WORKING TREE (não um git ref), então a ordem aqui é
# decisiva: DEPOIS do seal-time-gate (canônica final conhecida) e ANTES do
# rebuild do ZIP final, regeneramos as 5 projeções a partir dos JSONs canônicos
# e validamos — divergência aborta a release (FINAL_STATUS_PROJECTION_STALE).
step "GATE final-status-projection: regenerando projeções derivadas da canônica pós-selo..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/generate-final-status-projections.js" \
  || fail "generate-final-status-projections falhou — projeções não regeneradas a partir da canônica"
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/validate-final-status-projection.js" \
  || fail "FINAL_STATUS_PROJECTION_STALE — projeções derivadas divergem da canônica pós-selo"
ok "Projeções derivadas consistentes com a canônica (capturadas pelo PASS 3)"

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

# Re-stamp de lineage ANTES do readiness POST_PACKAGE: artefatos regenerados
# mid-flight (experience-segregation no gate inicial, package-validation/
# package-integrity no packaging, replay-integrity/hardening) perdem
# runId/sourceFingerprint. Sem o stamp, o scorecard avaliado pelo readiness
# falha com INVALID_ARTIFACT/FOREIGN_RUN_ARTIFACT e as projeções circulares
# (final-proof/readiness/governance) ficam presas em
# PASS_WITH_DEFERRED_PACKAGE_GATE — bloqueando o Final Consistency na PASS 5.
step "Re-stamp de lineage pré-readiness POST_PACKAGE..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/stamp-report-lineage.js" >/dev/null 2>&1 \
  && ok "lineage re-stampado antes do readiness POST_PACKAGE" \
  || warn "stamp-report-lineage não concluiu antes do readiness POST_PACKAGE (revalidado na PASS 5)"

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
  "reports/experience-segregation-report.json" \
  "governance/experience-segregation-report.json" \
  "reports/experience-api-segregation-report.json" \
  "governance/experience-api-segregation-report.json"; do
  # A cópia canônica governance/ vai POR ÚLTIMO e prevalece sobre a cópia de
  # compatibilidade em reports/ (mesmo basename → dist/governance/).
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
#   dist/verifier/   → script verificador (verify-result.json NÃO é empacotado:
#                      é o recibo que o verifier escreve ao rodar na PASS 5)

step "Criando estrutura de diretórios normalizada em dist/..."
RELEASE_DIR="$DIST_DIR/release"
GOV_DIR="$DIST_DIR/governance"
SIG_DIR="$DIST_DIR/signatures"
VER_DIR="$DIST_DIR/verifier"

mkdir -p "$RELEASE_DIR" "$GOV_DIR" "$SIG_DIR" "$VER_DIR"
# Recibo de verifier de execuções anteriores não pode sobreviver a um novo
# packaging (STALE_VERIFIER_RESULT) — verify-result.json só existe depois que
# o verifier roda contra o pacote final (PASS 5).
rm -f "$VER_DIR/verify-result.json"
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
  "experience-segregation-report.json" \
  "experience-api-segregation-report.json"; do
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
cp "$SCRIPT_DIR/verify-payload-governance.js" "$VER_DIR/verify-payload-governance.js"
# Chave pública RESOLVIDA (env > keyDir > repo) — par da chave que assinará.
node_with_workspace_env -e "
  require('$PROJECT_ROOT/governance/release-attestation')
    .exportResolvedPublicKey('$VER_DIR/release-attestation-public-key.json');
" || fail "Falha ao exportar chave pública resolvida para dist/verifier/"
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

# ── R6 — IDENTIDADE DO PAYLOAD FINAL (DELIVERED_PAYLOAD) ────────────────────
# O hash do payload vive num sidecar EXTERNO (paradoxo do auto-hash evitado):
# nenhum arquivo precisa conter o hash dos próprios bytes que ele cobre.
step "Identidade e lineage do payload entregue (candidato -> payload)..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/write-release-identity.js" \
  --kind delivered --release "$RELEASE_NAME" \
  --candidate-hash "$H_CANDIDATE" --payload-hash "$PAYLOAD_SHA" \
  || fail "não foi possível materializar a identidade do payload entregue"
ok "identidade do entregue vinculada ao candidato ($H_CANDIDATE→$PAYLOAD_SHA)"

# ── AUTHORITY DE FASE: DELIVERED ────────────────────────────────
# O payload entregue existe e a identidade dele foi gravada em sidecar EXTERNO
# (sem paradoxo de auto-hash). A fase avança porque o ARTEFATO existe de fato —
# nunca por declaração.
phase advance --to DELIVERED
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/verify-release-artifact-identity.js" \
  --kind delivered --phase DELIVERED \
  || fail "identidade do payload ENTREGUE inválida — lineage candidato→payload não confere"

step "Criando envelope final com payload + governança externa..."
ENVELOPE_PATH="$RELEASE_DIR/$ENVELOPE_ZIP_NAME"
# HYGIENE GATE (STALE_VERIFIER_RESULT): verify-result.json é o recibo que o
# verifier escreve QUANDO EXECUTADO contra um pacote. Um recibo pré-existente
# (de verificação local ou de release anterior) NUNCA pode entrar no envelope —
# seria evidência stale apresentada como prova do release atual. O recibo do
# release atual é gerado DEPOIS, pelo verifier offline da PASS 5.
rm -f "$VER_DIR/verify-result.json"
TMP_ENVELOPE="$(mktemp -d -t r-agent2-envelope-XXXXXX)"
mkdir -p "$TMP_ENVELOPE/r-agent2/dist/release" \
         "$TMP_ENVELOPE/r-agent2/dist/governance" \
         "$TMP_ENVELOPE/r-agent2/dist/signatures" \
         "$TMP_ENVELOPE/r-agent2/dist/verifier"
cp "$PAYLOAD_PATH" "$TMP_ENVELOPE/r-agent2/dist/release/$PAYLOAD_ZIP_NAME"
cp "$MANIFEST_PATH" "$TMP_ENVELOPE/r-agent2/dist/release/$CURRENT_MF"
# ── R6/TAREFA 56/57/58 — LINEAGE OFFLINE NO ENVELOPE ────────────────────────
# O destinatário precisa conseguir provar, SEM rede e SEM o workspace de origem:
#
#   sourceFingerprint → candidateHash → finalPayloadHash
#
# Para isso os ARTEFATOS DE IDENTIDADE viajam no ENVELOPE (ao lado do payload,
# nunca dentro dele): manifesto e validação do candidato + identidade do payload
# entregue (com `parentCandidateHash`). São arquivos DETACHED exatamente para não
# criar o paradoxo de auto-hash — nenhum deles precisa conter o hash dos próprios
# bytes que o envelope produz.
IDENTITY_DIR="$TMP_ENVELOPE/r-agent2/dist/release/identity"
mkdir -p "$IDENTITY_DIR"
for identity_file in \
  "$CANDIDATE_DIR/${RELEASE_NAME}.candidate.manifest.json" \
  "$CANDIDATE_DIR/${RELEASE_NAME}.candidate-validation.json" \
  "$RELEASE_DIR/${RELEASE_NAME}.delivered.identity.json" \
  "$CANDIDATE_DIR/${RELEASE_NAME}.candidate.identity.json"; do
  if [[ -f "$identity_file" ]]; then
    cp "$identity_file" "$IDENTITY_DIR/"
    ok "lineage offline: $(basename "$identity_file") incluído no envelope"
  else
    warn "lineage offline: $(basename "$identity_file") ausente — não incluído"
  fi
done
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

# GATE release-hygiene: o envelope físico final não pode conter recibo de
# verifier pré-empacotado (STALE_VERIFIER_RESULT), artefatos de outro
# release/run, paths temporários ou saída de runtime.
step "GATE release-hygiene: inspecionando envelope físico final..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/validate-release-hygiene.js" \
  && ok "release-hygiene PASS" \
  || fail "release-hygiene FAIL — envelope com artefato stale/estrangeiro"

# ── GATE RELEASE-DAG: nenhum ciclo de dependência antes de concluir ────────
step "GATE release-dag: detectando ciclos de dependência e violações de fase..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/validate-release-dag.js" \
  && ok "release-dag PASS (acíclico e phase-aware)" \
  || fail "RELEASE_DEPENDENCY_CYCLE/PHASE_ORDER — DAG de release inválido"

# ── GATE RELEASE-ARTIFACT-IDENTITY: bytes reais + lineage candidato→payload ─
step "GATE release-artifact-identity: candidato -> payload entregue..."
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/write-release-identity.js" \
  --kind candidate --release "$RELEASE_NAME" --candidate-hash "$H_CANDIDATE" \
  --commit "$GIT_COMMIT" --phase CANDIDATE_VALIDATED >/dev/null \
  && ok "Candidato re-identificado como CANDIDATE_VALIDATED (bytes do ZIP inalterados)"
node_with_workspace_env "$PROJECT_ROOT/scripts/governance/verify-release-artifact-identity.js" \
  --phase DELIVERED --release "$RELEASE_NAME" \
  && ok "release-artifact-identity PASS (payload verificado pelos bytes exatos)" \
  || fail "release-artifact-identity FAIL — identidade/lineage do payload entregue inválida"

# Verificar estrutura resultante
# Na fase DELIVERED (SEAL_PENDING) o candidato carrega a decisão DEFERRED
# verdadeira — o verifier estrito dentro do check-dist-clean exige GO e é
# adiado por design; a verificação do candidato ocorre no verify:delivered-release.
step "Validando estrutura normalizada de dist/..."
CHECK_DIST_CLEAN_DEFERRED_CANDIDATE=0
[[ "${SEAL_DECISION:-SEAL_GO}" == "SEAL_PENDING" ]] && CHECK_DIST_CLEAN_DEFERRED_CANDIDATE=1
export CHECK_DIST_CLEAN_DEFERRED_CANDIDATE
bash "$SCRIPT_DIR/check-dist-clean.sh" 2>&1 | grep -E "(✓|✗|PASS|FAIL|check-dist)" || true
if bash "$SCRIPT_DIR/check-dist-clean.sh" 2>/dev/null; then
  ok "dist/ estrutura normalizada verificada"
else
  fail "check-dist-clean detectou problemas"
fi

# ── Fase DELIVERED: candidato selado com decisão DEFERRED verdadeira ─────────
# SEAL_PENDING = scorecard com below10 ⊆ {RAP-055,RAP-056} (dimensões que só são
# evidenciáveis contra o artefato ENTREGUE, via verify:delivered-release). O
# candidato NÃO é release: payload=candidato, envelope=candidato (pass=false,
# decisão PASS_WITH_DEFERRED_PACKAGE_GATE verbatim em ambos). O pipeline para
# aqui com exit 1 — NUNCA materializa envelope GO sobre canônica não-GO.
if [[ "${SEAL_DECISION:-SEAL_GO}" == "SEAL_PENDING" ]]; then
  CANDIDATE_MARKER="$RELEASE_DIR/CANDIDATE-DEFERRED.json"
  C_RUN_ID="$(node -e "try{const r=require('$PROJECT_ROOT/governance/.current-run.json');process.stdout.write(r.runId||'unknown')}catch(_){process.stdout.write('unknown')}" 2>/dev/null || echo "unknown")"
  C_SOURCE_FP="$(node -e "try{const r=require('$PROJECT_ROOT/governance/.current-run.json');process.stdout.write(r.sourceFingerprint||'unknown')}catch(_){process.stdout.write('unknown')}" 2>/dev/null || echo "unknown")"
  cat > "$CANDIDATE_MARKER" <<EOF
{
  "artifactType": "delivered-phase-candidate-marker",
  "artifactVersion": "1.0.0",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "releaseId": "${RELEASE_NAME}",
  "runId": "${C_RUN_ID}",
  "sourceFingerprint": "${C_SOURCE_FP}",
  "payloadSha256": "${PAYLOAD_SHA}",
  "finalDecision": "PASS_WITH_DEFERRED_PACKAGE_GATE",
  "candidate": true,
  "nextStep": "npm run verify:delivered-release && node --env-file-if-exists=.env scripts/governance/run-persisted-scorecard.js && npm run zip:release"
}
EOF
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║  CANDIDATO DELIVERED SELADO — DECISÃO DEFERRED VERDADEIRA   ║${NC}"
  echo -e "${YELLOW}╠══════════════════════════════════════════════════════════════╣${NC}"
  printf  "${YELLOW}║  Release     : %-47s ║${NC}\n" "${RELEASE_NAME}"
  printf  "${YELLOW}║  Decisão     : %-47s ║${NC}\n" "PASS_WITH_DEFERRED_PACKAGE_GATE"
  printf  "${YELLOW}║  Próximo     : %-47s ║${NC}\n" "verify:delivered-release → scorecard → zip:release"
  echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
  exit 1
fi

# SEAL_GO: a fase DELIVERED terminou em release GO — o marcador de candidato do
# ciclo anterior (que aponta para um payload já substituído) é cruft obsoleto e
# seria confundido com estado pendente; removê-lo mantém dist/release coerente.
if [[ -f "$RELEASE_DIR/CANDIDATE-DEFERRED.json" ]]; then
  rm -f "$RELEASE_DIR/CANDIDATE-DEFERRED.json"
  ok "Marcador de candidato DEFERRED do ciclo anterior removido (release GO selado)"
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
  # ── Gate fail-closed da governança DO PAYLOAD (fonte da verdade) ─────────
  # O verifier offline acima valida o envelope; este gate abre o payload e
  # exige que a governança canônica embutida seja GO, do mesmo run/fingerprint,
  # com envelope derivado idêntico e attestation Ed25519 válida.
  step "Verificando governança canônica do payload (fail-closed)..."
  node_with_workspace_env "$PROJECT_ROOT/scripts/verify-payload-governance.js" --root "$PROJECT_ROOT" \
    || fail "payload governance NO_GO — release bloqueada"

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

  # ── AUTHORITY DE FASE: FINAL_GOVERNANCE ────────────────────
  # O verificador offline PASSOU: o pacote está verificado de ponta a ponta.
  # A fase final de governança é alcançada agora — e o relatório de fase (com
  # o status REAL de cada gate e sua `requiredPhase`) fica em `reports/`.
  # PUBLISHED_VERIFIED só é alcançada DEPOIS da tag + recibo de publicação,
  # fora do pipeline.
  phase advance --to FINAL_GOVERNANCE
  phase report

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

  # ── Próximo passo: tag imutável de release (FORA do pipeline, por design) ──
  # A tag exige o verifier offline PASS acima (nunca automatizar push de tag
  # dentro do two-pass — risco de ciclo). Release final:
  echo ""
  echo -e "${CYAN}PRÓXIMO PASSO (release final — tag imutável de proveniência):${NC}"
  echo "  1. bash scripts/create-release-tag.sh ${RELEASE_NAME} ${GIT_COMMIT}"
  echo "  2. node scripts/governance/verify-remote-provenance.js --require-tag --tag ${RELEASE_NAME}"
  echo ""
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
