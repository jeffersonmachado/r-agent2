#!/usr/bin/env bash
#
# seal-release.sh — ORQUESTRADOR DO CICLO DE SELAGEM E PUBLICAÇÃO.
#
# POR QUE ESTE SCRIPT EXISTE
# --------------------------
# O INTERIOR do pacote já era scriptado (`scripts/release-package.sh` faz os dois
# passes, rebind, higiene, envelope e assinatura Ed25519; `seal-time-gate.js`
# decide GO/NO_GO). O que NÃO era scriptado era a ORQUESTRAÇÃO DAS FASES em volta
# disso — e era exatamente ali que o processo travava. Cada fase abaixo encarna
# uma armadilha que custou um ciclo inteiro de investigação manual:
#
#   * Rodar `converge` ou o scorecard com `dist/` vazio RE-ENVENENA os relatórios
#     projetados (below10 salta de 2 para ~29) e o `zip:release` trava em
#     "platform-readiness retornou NO_GO com gaps bloqueantes". O scorecard é
#     re-derivador: rodá-lo 2x nesse estado AMPLIFICA (16 -> 34). Por isso a fase
#     `prepare` roda o `converge`, que REGENERA
#     `governance/critical-journey-evidence.json` e
#     `qa/qa-waves-enterprise-governance.json` com o lineage do run corrente —
#     eliminando os `FOREIGN_RUN_ARTIFACT`. O `stamp-report-lineage.js` NÃO
#     resolve isso: esses dois arquivos não estão na lista dele.
#
#   * O `zip:release` faz candidato (exit 1, INTENCIONAL) e final (exit 0). Tratar
#     o exit 1 como erro aborta um ciclo que está funcionando.
#
#   * `verify-remote-provenance` PRECISA de `--manifest`. Sem a flag ele cai em
#     `rev-parse HEAD`, e qualquer commit posterior ao selo produz
#     `RELEASE_TAG_CONFLICT` com uma mensagem que parece corrupção de tag.
#
#   * A varredura agregada (`validate:governance-enforcement`) REGENERA
#     `experience-segregation-report.json` SEM os campos de lineage e o packaging
#     regenera `qa-waves/journey-coverage/*.json`, invalidando a projeção de
#     jornada. Rodá-la DEPOIS do selo quebra `verify:delivered-release`. Aqui ela
#     roda na fase `consolidate`, e as duas reparações (`journey:projections` +
#     `stamp-report-lineage`) rodam LOGO DEPOIS, na mesma fase. Nunca rodar o
#     agregado novamente depois disso.
#
#   * O `zip:release` exige worktree limpo (GATE DIRTY_WORKTREE, fail-closed) e
#     deixa o worktree sujo ao terminar. Por isso cada fase termina commitando.
#
#   * O commit do release é lido do MANIFEST (`git_commit`), nunca do banner nem
#     do HEAD: o banner é informativo e o HEAD pode ter avançado.
#
# Uso:
#   bash scripts/governance/seal-release.sh --dry-run
#   bash scripts/governance/seal-release.sh                  # ciclo completo
#   bash scripts/governance/seal-release.sh --from candidate  # retoma da fase
#
# Fases: prepare -> candidate -> final -> consolidate -> certify -> publish -> verify-delivery
#
# ORDEM CERTIFICA-ANTES-DE-PUBLICAR (P0-3, 2026-10-16): `consolidate` reconcilia,
# `certify` afirma sobre o artefato congelado ANTES de publicar e `publish` é a única
# fase que cria a tag. Antes a tag era criada na 4ª de 5 fases — os gates obrigatórios
# rodavam depois dela (medido: três ciclos abortaram com a tag já no remote).
# `verify-delivery` confirma a ENTREGA depois, separada da certificação.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

LOG_DIR="${SEAL_LOG_DIR:-/tmp/seal-release}"
mkdir -p "$LOG_DIR"

PHASES=(prepare candidate final consolidate certify publish verify-delivery)
FROM_PHASE="prepare"
DRY_RUN=0
SKIP_PUSH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM_PHASE="${2:-prepare}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-push) SKIP_PUSH=1; shift ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

cyan() { printf '\033[0;36m%s\033[0m\n' "$1"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }
bad()  { printf '\033[0;31m  ✗ %s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m  ⚠ %s\033[0m\n' "$1"; }
step() { printf '\033[0;34m[seal:%s] %s\033[0m\n' "$1" "$2"; }

fail() {
  bad "$1"
  echo "  log: $2"
  echo "  retome com: bash scripts/governance/seal-release.sh --from $3"
  exit 1
}

dirty_count() { git status --porcelain | wc -l | tr -d ' '; }

# Nome do release usado na aprovação de deploy. Fonte primária: o estado gravado
# pela fase `final` ($LOG_DIR/release.env, linha 1). Se esse estado foi perdido
# (reboot limpa /tmp — medido 2026-10-05), a retomada de `--from consolidate`
# NÃO pode culpar o artefato: o nome é derivado do MESMO modo que a fase `final`
# deriva (basename de dist/release/<release>.manifest.json). Ambiguidade (2+
# envelopes) é fail-closed — o script nunca escolhe um envelope por conta própria.
resolve_release_name() {
  if [ -f "$LOG_DIR/release.env" ]; then
    sed -n 1p "$LOG_DIR/release.env"
    return 0
  fi
  local manifests count
  manifests="$(ls -1 dist/release/*.manifest.json 2>/dev/null || true)"
  count="$(printf '%s\n' "$manifests" | grep -c . || true)"
  [ "$count" = "1" ] || return 1
  basename "$manifests" .manifest.json
}

commit_and_push() {
  local message="$1"
  if [ "$(dirty_count)" = "0" ]; then
    ok "worktree limpo (nada a commitar)"
  else
    git add -A || return 1
    git commit -q -m "$message" || return 1
    ok "commit: $message"
  fi
  if [ "$SKIP_PUSH" = "1" ]; then
    warn "push pulado (--skip-push)"
    return 0
  fi
  git push origin main -q || return 1
  ok "push ok"
}

# ── Preflight ---------------------------------------------------------------
preflight() {
  cyan "╔══════════════════════════════════════════════════════════════╗"
  cyan "║  SEAL RELEASE — orquestrador de selagem e publicação         ║"
  cyan "╚══════════════════════════════════════════════════════════════╝"

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = "main" ] || { bad "branch atual é '$branch' (esperado main)"; exit 1; }
  ok "branch: main"

  local d
  d="$(dirty_count)"
  if [ "$d" != "0" ]; then
    bad "worktree sujo ($d arquivo(s)) — o zip:release é fail-closed (GATE DIRTY_WORKTREE)"
    git status --porcelain | head -10
    exit 1
  fi
  ok "worktree limpo"

  if ls dist/release/*.payload.zip >/dev/null 2>&1; then
    ok "dist/ tem pacote entregue (tolerância de fase DELIVERED ativa)"
  else
    warn "dist/ SEM payload: a tolerância de fase DELIVERED morre e o scorecard conta"
    warn "RAP-052/RAP-054 como falha real. A fase 'prepare' (converge) é obrigatória."
  fi

  if command -v psql >/dev/null 2>&1 && [ -f .env ]; then
    ok "psql disponível (lineage/runId persistidos acessíveis)"
  else
    warn "psql/.env ausentes — gates que exigem lineage persistido podem falhar"
  fi

  # Pré-requisito BLOQUEANTE da fase `consolidate`: evidência de smoke contínuo
  # das QA Waves dentro da validade (TTL, default 48 h).
  #
  # `validate:qa-governance` (dentro do gate agregado) NÃO lê o JSON commitado:
  # reconstrói o veredito pelo bridge e marca a evidência como vencida quando o
  # `generatedAt` é mais antigo que `QA_WAVES_SCHEDULED_MAX_AGE_HOURS`. Como o
  # agregado roda na ÚLTIMA fase, descobrir isso lá custa um ciclo inteiro
  # (~1,5-2 h) para abortar no fim — medido em 2026-09-27 (evidência com 35 h no
  # selo, 49,6 h ~13 h depois). Aqui roda a MESMA avaliação do próprio bridge
  # (sem duplicar o threshold) ANTES de qualquer trabalho: falha rápida com o
  # remédio explícito.
  #
  # Renovar é trabalho do produtor canônico agendado (cron diário):
  #   ./scripts/smoke/run-scheduled-production-health-smoke.sh
  # Ele exige stack prod-like em Docker e DERRUBA os serviços de dev (API node,
  # Vite, RAG) para liberar :3001/:5173/:8001 — por isso NÃO pode ser chamado
  # daqui: o preflight do converge exige esses três serviços vivos.
  #
  # `--env-file-if-exists=.env` é OBRIGATÓRIO para reproduzir o gate: sem a
  # chave de assinatura (`validateReplayIntegrity` a usa) TODOS os fluxos
  # passam a divergir da evidência-fonte com
  # `scheduled_flow_source_mismatch:<jornada>:integrityValid` (medido em
  # 2026-09-27) — ou seja, sem `.env` esta checagem bloquearia selo válido.
  # Autoridade ÚNICA da avaliação do TTL (o `.env` é carregado pelo próprio script):
  # a mesma chamada é repetida no início do `consolidate`, porque o ciclo leva
  # ~1,5 h e a evidência (TTL 48 h) pode vencer no MEIO dele.
  local qa_state qa_rc
  qa_state="$(node "$ROOT/scripts/governance/qa-waves-scheduled-ttl-preflight.js" 2>/dev/null)"
  qa_rc=$?

  if [ "$qa_rc" = "0" ] && [ "$qa_state" = "OK" ]; then
    ok "evidência de smoke contínuo das QA Waves dentro da validade"
  elif [ "$qa_rc" = "2" ] || [ -z "$qa_state" ]; then
    bad "não foi possível avaliar a evidência de smoke contínuo das QA Waves"
    echo "      (falha ao carregar .env/bridge — verifique .env e node_modules antes do ciclo)"
    [ "$DRY_RUN" = "1" ] || exit 1
  else
    bad "evidência de smoke contínuo das QA Waves vencida/inválida — o agregado ABORTA na fase consolidate"
    echo "      avaliação: ${qa_state}"
    echo "      renove com o produtor canônico (cron diário):"
    echo "        ./scripts/smoke/run-scheduled-production-health-smoke.sh"
    echo "      (exige stack prod-like em Docker; derruba os serviços de dev)"
    if [ "$DRY_RUN" = "1" ]; then
      warn "dry-run: seguindo só para imprimir o plano (um ciclo real abortaria aqui)"
    else
      exit 1
    fi
  fi

  # Pré-requisito BLOQUEANTE da fase `consolidate`: evidência de runtime do Ask-AI
  # dentro do TTL (7 dias).
  #
  # MESMA classe do smoke contínuo acima, com custo MAIOR: medido em 2026-10-15, o
  # ciclo inteiro rodou (QA Mesh real, empacotamento, tag PUBLICADA) e abortou no
  # `consolidate` com `ASK_AI_RUNTIME_EVIDENCE_STALE` (177,8 h de 168 h) — ~2 h
  # perdidas e a tag já publicada. O produtor é manual
  # (`npm run verify:ask-ai-copilot:runtime`, exige API viva + credencial de
  # verificação), logo nada o renova sozinho: checar na ENTRADA é o único modo de
  # não descobrir no fim. Autoridade única do TTL: o mesmo módulo que o validador
  # do agregado usa (sem duplicar threshold).
  local askai_state askai_rc
  askai_state="$(node "$ROOT/scripts/governance/ask-ai-runtime-evidence-ttl-preflight.js" 2>/dev/null)"
  askai_rc=$?

  if [ "$askai_rc" = "0" ] && [ "$askai_state" = "OK" ]; then
    ok "evidência de runtime do Ask-AI dentro da validade"
  elif [ "$askai_rc" = "2" ] || [ -z "$askai_state" ]; then
    bad "não foi possível avaliar a evidência de runtime do Ask-AI"
    echo "      (falha ao carregar a lib de avaliação — verifique node_modules antes do ciclo)"
    [ "$DRY_RUN" = "1" ] || exit 1
  else
    bad "evidência de runtime do Ask-AI vencida/inválida — o agregado ABORTA na fase consolidate"
    echo "      avaliação: ${askai_state}"
    echo "      renove com o produtor canônico (exige a API viva em :3001):"
    echo "        ASKAI_VERIFY_USER=... ASKAI_VERIFY_PASSWORD=... npm run verify:ask-ai-copilot:runtime"
    if [ "$DRY_RUN" = "1" ]; then
      warn "dry-run: seguindo só para imprimir o plano (um ciclo real abortaria aqui)"
    else
      exit 1
    fi
  fi
}

# ── Fase 1: prepare ---------------------------------------------------------
# Run governado do fingerprint corrente + converge + commit.
phase_prepare() {
  step prepare "run governado + converge (regenera os artefatos FOREIGN)"

  # DEFEITO DE ORDEM corrigido em 2026-09-12, descoberto USANDO este script: o
  # scorecard exige `governance/delivered-release-verification-report.json`, mas
  # esse artefato é produzido por `verify:delivered-release`, que a fase
  # `candidate` só roda DEPOIS do packaging — ordem impossível num run novo. Sem
  # este refresh o converge falha com ARTIFACT_MISSING e below10 salta para ~29,
  # por cascata de NO_GO em final-proof/final-readiness/final-consistency.
  # O exit é ignorado DE PROPÓSITO: o veredito do verify é sobre a release
  # ENTREGUE (a anterior), não sobre este ciclo em andamento.
  timeout 900 npm run verify:delivered-release > "$LOG_DIR/verify-pre-prepare.log" 2>&1 || true
  if [ -f governance/delivered-release-verification-report.json ]; then
    ok "delivered-release-verification-report.json presente para o scorecard"
  else
    warn "delivered-release-verification-report.json ausente após o refresh"
  fi

  local log="$LOG_DIR/converge.log"
  # Orçamento de processo (não é TTL de evidência): o converge executa o QA
  # Mesh canônico DENTRO de si (passo 8/12, timeout 5400) + enterprise proof +
  # evidência executável + fixpoint + seal-time-gate. 7200s = 90min do mesh +
  # 30min de margem para os demais 11 passos (travado em
  # tests/unit/governance/sealConvergeTimeoutBudget.test.js — T19).
  timeout 7200 bash scripts/governance/converge-governance.sh > "$log" 2>&1
  local rc=$?

  # Self-healing: se o run governado for de um fingerprint anterior, o converge
  # falha com RUN_SOURCE_DRIFT. Criamos o run do fingerprint atual e repetimos.
  #
  # DEFEITO MEDIDO (2026-10-05, custou DOIS meshes e ~70min): o gatilho era
  # `grep -q 'RUN_SOURCE_DRIFT\|source drift'`, e o log da converge contém NOMES
  # DE TESTE com essa expressão — `✓ rejeita scorecard incompleto e source drift
  # (171 ms)`. Qualquer falha da converge que executasse essa suíte disparava a
  # "recuperação de drift": criava run novo (invalidando toda a evidência já
  # produzida no run anterior, que passava a pré-run) e reexecutava a converge
  # inteira, incluindo um segundo QA Mesh. O gatilho agora casa apenas a linha
  # do PRÓPRIO drift-guard, que é o sinal real.
  if [ "$rc" != "0" ] && grep -qE '^\[drift-guard\] RUN_SOURCE_DRIFT:' "$log"; then
    warn "RUN_SOURCE_DRIFT detectado — criando run governado do fingerprint atual"
    node scripts/governance/create-governed-run.js > "$LOG_DIR/create-run.log" 2>&1 || \
      fail "falha ao criar run governado" "$LOG_DIR/create-run.log" prepare

    # PREFLIGHT fail-fast (P1-11): as 3 waves tecnicas passaram a ser conferidas
    # contra o run corrente pelo validate-coverage-gate. Waves carimbadas com o
    # run ANTERIOR degradam para STALE. Sem esta checagem o problema so
    # apareceria no fim da converge (~35 min de QA Mesh) e o operador teria de
    # reiniciar o ciclo — mesmo padrao do H17-PREFLIGHT-ASK-AI-TTL.
    if ! node scripts/governance/check-wave-evidence-same-run.js > "$LOG_DIR/wave-same-run.log" 2>&1; then
      cat "$LOG_DIR/wave-same-run.log" >&2 || true
      fail "waves tecnicas pertencem a OUTRO run — regenere as waves DENTRO do run corrente (comandos no log) e rode novamente com --from prepare" "$LOG_DIR/wave-same-run.log" prepare
    fi
    ok "waves tecnicas conferem com o run corrente (SAME_RUN)"
    # DEFEITO MEDIDO (2026-10-06): o refresh acima roda ANTES de o run existir.
    # O proof set do scorecard exige evidência SAME_RUN, então o relatório
    # renascia com generatedAt < run.startedAt e a fase `candidate` reprovava em
    # `master_scorecard: SCORECARD_EVIDENCE_PROOF_INVALID - STALE_ARTIFACT
    # (3 violações em 315 provas)` — o tamanho da violação é o nº de requisitos
    # que declaram esse artefato. O relatório é meta-evidência sobre a release
    # ENTREGUE (a anterior), mas o CARIMBO tem de estar dentro do run: por isso
    # ele é regerado aqui, DEPOIS do run nascer, e o frescor é conferido de
    # forma fail-closed (nunca seguir com evidência pré-run).
    timeout 900 npm run verify:delivered-release > "$LOG_DIR/verify-post-run.log" 2>&1 || true
    if ! node -e '
      const fs=require("fs");
      try{
        const r=JSON.parse(fs.readFileSync("governance/.current-run.json","utf8"));
        const d=JSON.parse(fs.readFileSync("governance/delivered-release-verification-report.json","utf8"));
        const started=Date.parse(r.startedAt||""), gen=Date.parse(d.generatedAt||"");
        process.stdout.write(String(gen)+" >= "+String(started)+"\n");
        process.exit(Number.isFinite(started)&&Number.isFinite(gen)&&gen>=started?0:1);
      }catch(err){process.stdout.write("erro: "+err.message+"\n");process.exit(1);}
    ' > "$LOG_DIR/verify-post-run-freshness.log" 2>&1; then
      warn "delivered-release-verification-report.json continuou PRÉ-RUN após o refresh"
      cat "$LOG_DIR/verify-post-run-freshness.log" >&2 || true
      fail "evidência pré-run no run novo (proof set exigiria STALE_ARTIFACT)" "$LOG_DIR/verify-post-run.log" prepare
    fi
    ok "delivered-release-verification-report.json regerado DENTRO do run (SAME_RUN)"
    timeout 7200 bash scripts/governance/converge-governance.sh > "$log" 2>&1
    rc=$?
  fi

  local verdict
  verdict="$(grep -oE 'SEAL_(GO|PENDING|NO_GO)' "$log" | tail -1)"
  # DEFEITO DE DIAGNÓSTICO (medido 2026-10-05): quando o converge ABORTA antes do
  # seal-time-gate, não existe marcador SEAL_* no log e a mensagem saía como
  # "converge não convergiu ()" — sem dizer QUAL passo morreu, obrigando a
  # arqueologia no log. Aqui o veredito vazio passa a nomear o último passo
  # anunciado pelo converge e a última linha de erro que ele emitiu.
  if [ -z "$verdict" ]; then
    local last_step last_error
    last_step="$(grep -oE '\[converge\] [0-9]+(\.[0-9]+)?/12 [^—]*' "$log" | tail -1 | sed -E 's/^\[converge\] //; s/[[:space:]]+$//')"
    last_error="$(grep -E '^\[artifact-refresh\]|^\[converge\] FALHOU|ERRO|ERROR:|não convergiu|falhou' "$log" | tail -1 | cut -c1-160)"
    verdict="abortado em ${last_step:-passo não identificado}${last_error:+ | ultima linha: $last_error}"
  fi

  # QA MESH + ENTERPRISE PROOF DENTRO DO RUN (2026-09-20, T4/T15/T17): ambos são
  # RUNTIME_EVIDENCE e executam DENTRO do converge-governance.sh (passos 1/12 e
  # 8/12), ANTES do stamp, do scorecard e do seal-time-gate. Até 2026-09-19 o
  # mesh rodava aqui, DEPOIS do veredito — e o seal-time-gate avaliava o run
  # novo sem evidência same-run: RAP-024/026/068 caíam como
  # FOREIGN_RUN_ARTIFACT (falha "real") → SEAL_NO_GO com o mesh nunca executado
  # (deadlock medido no run rap-governed-20260920040310055). A ordem canônica é
  # CREATE RUN → QA Mesh → evidências → scorecard → gate, e o converge é o
  # sequenciador único dessa ordem.

  case "$verdict" in
    SEAL_PENDING|SEAL_GO)
      ok "seal-time-gate: $verdict"
      grep -oE 'below10=\[[^]]*\]' "$log" | tail -1 | sed 's/^/    /' || true
      ;;
    *)
      # RECONCILIAÇÃO antes de falhar. O converge cria o run governado logo no
      # início e só regenera a projeção de readiness no passo 4/8. Se ele morre
      # no meio (ex.: SEAL_NO_GO no passo 8), `.current-run.json` fica apontando
      # para o run novo enquanto `dev/platform-readiness/latest.json` continua com
      # o run anterior — e o invariante testado por
      # `tests/unit/governance/convergenceFixpoint.test.js` ("o runId da projeção
      # é o do run corrente") quebra, deixando o repositório inconsistente.
      # O produtor canônico da projeção é este (o converge o usa antes do
      # fixpoint); o exit é tolerado porque espelha a decisão, não a execução.
      warn "converge não convergiu ($verdict) — reconciliando a projeção de readiness"
      timeout 600 node --env-file-if-exists=.env tools/system/platform-readiness.js \
        > "$LOG_DIR/readiness-reconcile.log" 2>&1 || true
      local cur proj
      cur="$(node -e "try{console.log(require('./governance/.current-run.json').runId)}catch(e){console.log('?')}" 2>/dev/null)"
      proj="$(node -e "try{console.log(require('./dev/platform-readiness/latest.json').runId)}catch(e){console.log('?')}" 2>/dev/null)"
      if [ "$cur" = "$proj" ]; then
        ok "projeção reconciliada com o run corrente ($cur)"
      else
        warn "projeção ainda divergente: run=$cur projecao=$proj"
      fi
      fail "seal-time-gate não convergiu ($verdict)" "$log" prepare
      ;;
  esac

  commit_and_push "chore(governance): converge do ciclo de selagem ($verdict)" || \
    fail "falha ao commitar/pushar a fase prepare" "$log" prepare
}

# ── Fase 2: candidate -------------------------------------------------------
# Pacote candidato (exit 1 intencional) -> verificação -> scorecard 78/78 ->
# projeções -> fixpoint -> commit.
phase_candidate() {
  step candidate "pacote candidato (exit 1 é esperado) + scorecard + projeções"

  local zlog="$LOG_DIR/zip-candidate.log"
  # Orçamento de processo (não é TTL de evidência): o zip:release (two-pass)
  # executa o converge-governance.sh COMPLETO em PRE_PACKAGE — incluindo o QA
  # Mesh (timeout 5400) desde o T17. 7200s = 90min do mesh + 30min para os
  # demais passos + packaging (mesma classe do T19; medido em 2026-09-20 com o
  # two-pass morto aos exatos 45min do antigo timeout 2700 — T25, travado em
  # tests/unit/governance/sealZipReleaseTimeoutBudget.test.js).
  timeout 7200 npm run zip:release > "$zlog" 2>&1
  local rc=$?

  if grep -q 'CANDIDATO DELIVERED SELADO' "$zlog"; then
    ok "candidato selado (exit $rc, DEFERRED verdadeiro — esperado)"
  elif [ "$rc" != "0" ]; then
    fail "candidato não selou" "$zlog" candidate
  fi

  # CADEIA FINAL DENTRO DO RUN, ANTES DO SCORECARD (missão 2026-10-05).
  #
  # O envelope candidato já existe: agora os produtores da cadeia FINAL/DELIVERED
  # que dependem do PACOTE podem rodar. Sem isto os 9 artefatos dessa cadeia
  # chegam ao scorecard com o lineage do run ANTERIOR (FOREIGN_RUN_ARTIFACT) ou
  # pré-run — o que só passava antes porque o stamp lhes reaplicava o runId atual
  # SEM que nada tivesse rodado neles (autoridade fabricada). Aqui eles são
  # REEXECUTADOS e depois ESTAMPADOS: o 78/78 passa a ser sustentado por
  # evidência produzida dentro DESTE run.
  if ! env ARTIFACT_REFRESH_PHASE=FINAL timeout 3600 npm run ensure:authoritative-artifacts-fresh > "$LOG_DIR/artifact-refresh-candidate.log" 2>&1; then
    fail "evidência da cadeia FINAL não reparável antes do scorecard (ver o relatório do ensure)" "$LOG_DIR/artifact-refresh-candidate.log" candidate
  fi
  if ! env ARTIFACT_REFRESH_PHASE=FINAL node scripts/governance/stamp-report-lineage.js > "$LOG_DIR/stamp-candidate.log" 2>&1; then
    fail "stamp da cadeia FINAL recusou evidência pré-run" "$LOG_DIR/stamp-candidate.log" candidate
  fi
  ok "cadeia FINAL reexecutada e estampada dentro do run"

  local vlog="$LOG_DIR/verify-delivered.log"
  timeout 900 npm run verify:delivered-release > "$vlog" 2>&1
  if grep -qE 'DELIVERED_RELEASE_VERIFIED|DELIVERED_PENDING_SCORECARD' "$vlog"; then
    ok "verify:delivered-release: $(grep -oE 'DELIVERED_[A-Z_]+' "$vlog" | tail -1)"
  else
    # Armadilha: lineage de experience-segregation clobberado por varredura prévia.
    warn "delivered não verificado — tentando reparar lineage e repetir"
    node scripts/governance/stamp-report-lineage.js > "$LOG_DIR/stamp-repair.log" 2>&1
    timeout 900 npm run verify:delivered-release > "$vlog" 2>&1
    if grep -qE 'DELIVERED_RELEASE_VERIFIED|DELIVERED_PENDING_SCORECARD' "$vlog"; then
      ok "verify:delivered-release: reparado por stamp-report-lineage"
    else
      fail "verify:delivered-release falhou" "$vlog" candidate
    fi
  fi

  local slog="$LOG_DIR/scorecard.log"
  # ARTIFACT_REFRESH_PHASE=FINAL: a cadeia FINAL jé foi reexecutada e estampada
  # logo acima, então ela NÃO pode mais ser tolerada como PENDING_PHASE — o
  # 78/78 desta fase tem de estar sustentado por evidência do run corrente.
  env ARTIFACT_REFRESH_PHASE=FINAL timeout 1200 node scripts/governance/run-persisted-scorecard.js > "$slog" 2>&1
  local below10
  below10="$(node -e "const t=require('fs').readFileSync('$slog','utf8');const l=t.split('\n').find(x=>x.includes('dimensionsBelow10'));if(l){console.log(JSON.parse(l).scorecard.dimensionsBelow10)}else{console.log('NA')}")"
  if [ "$below10" = "0" ]; then
    ok "scorecard: 78/78 (below10=0, AUTONOMOUS_READY)"
  else
    fail "scorecard com below10=$below10 (esperado 0)" "$slog" candidate
  fi

  step candidate "projeções canônicas + fixpoint"
  timeout 600 npm run generate:final-status-projections > "$LOG_DIR/projections.log" 2>&1
  timeout 600 npm run validate:final-status-projection >> "$LOG_DIR/projections.log" 2>&1
  if grep -q 'status=PASS issues=0' "$LOG_DIR/projections.log"; then
    ok "projeções canônicas: PASS issues=0"
  else
    fail "validação das projeções falhou" "$LOG_DIR/projections.log" candidate
  fi

  env ARTIFACT_REFRESH_PHASE=FINAL timeout 1200 node scripts/governance/run-persisted-scorecard.js > "$slog" 2>&1
  below10="$(node -e "const t=require('fs').readFileSync('$slog','utf8');const l=t.split('\n').find(x=>x.includes('dimensionsBelow10'));if(l){console.log(JSON.parse(l).scorecard.dimensionsBelow10)}else{console.log('NA')}")"
  [ "$below10" = "0" ] || fail "fixpoint instável (below10=$below10)" "$slog" candidate
  ok "fixpoint estável: below10=0"

  commit_and_push "chore(governance): candidato selado + scorecard 78/78 + projeções canônicas" || \
    fail "falha ao commitar/pushar a fase candidate" "$slog" candidate
}

# ── Fase 3: final -----------------------------------------------------------
# Pacote final (SEAL_GO, exit 0). Lê release/commit/A do MANIFEST, não do banner.
phase_final() {
  step final "pacote final (SEAL_GO, exit 0)"

  # INTEGRIDADE TEMPORAL ANTES DE EMPACOTAR (missão 2026-10-05).
  #
  # DEFEITO REAL: o pacote r-agent2-20261005-011259 carregou
  # `governance/mutable-json-state-validation-report.json` (01:20:06) e
  # `governance/json-persistence-audit.json` (01:20:05) com o lineage do run
  # criado às 02:30 — porque os produtores rodavam na varredura agregada, que
  # acontece DEPOIS do empacotamento (fase consolidate). O ZIP era construído
  # com evidência de ANTES do run.
  #
  # Aqui o produtor de todo artefato autoritativo stale é REEXECUTADO antes do
  # zip:release. Nada é estampado: `stamp-report-lineage` recusa pré-run, então
  # o empacotamento é fail-closed de verdade.
  if timeout 3600 env ARTIFACT_REFRESH_PHASE=FINAL npm run ensure:authoritative-artifacts-fresh > "$LOG_DIR/artifact-refresh.log" 2>&1; then
    ok "evidência autoritativa reexecutada no run (0 pré-run antes do pacote)"
  else
    fail "existe evidência autoritativa pré-run não reparável — reexecute o produtor declarado na taxonomia antes de empacotar" "$LOG_DIR/artifact-refresh.log" final
  fi

  local zlog="$LOG_DIR/zip-final.log"
  timeout 7200 npm run zip:release > "$zlog" 2>&1
  local rc=$?
  [ "$rc" = "0" ] || fail "zip:release final retornou exit $rc (esperado 0)" "$zlog" final

  local manifest
  manifest="$(ls -t dist/release/*.manifest.json 2>/dev/null | head -1)"
  [ -n "$manifest" ] || fail "nenhum manifest em dist/release/" "$zlog" final

  RELEASE_ID="$(basename "$manifest" .manifest.json)"
  RELEASE_COMMIT="$(node -e "console.log(require('./$manifest').git_commit)")"
  RELEASE_HFINAL="$(grep -oE 'H_final      : [0-9a-f]+' "$zlog" | tail -1 | awk '{print $3}')"

  ok "release:  $RELEASE_ID"
  ok "commit:   $RELEASE_COMMIT"
  ok "H_final:  $RELEASE_HFINAL"

  # O commit do release tem de estar no remote ANTES do tag/proveniência.
  git fetch origin main -q 2>/dev/null || true
  if git merge-base --is-ancestor "$RELEASE_COMMIT" origin/main 2>/dev/null; then
    ok "commit do release presente no remote"
  else
    fail "commit $RELEASE_COMMIT não está em origin/main — push antes de publicar" "$zlog" final
  fi

  printf '%s\n%s\n%s\n' "$RELEASE_ID" "$RELEASE_COMMIT" "$RELEASE_HFINAL" > "$LOG_DIR/release.env"
}

# ── Fase 6: publish — PUBLICAÇÃO (cria a tag) --------------------------------
# Única fase que cria a tag. Roda DEPOIS da certificação (P0-3): uma falha em
# qualquer gate pré-publicação impede chegar aqui.
phase_publish() {
  step publish "tag imutável + proveniência remota + recibo + publicação"

  [ -f "$LOG_DIR/release.env" ] || fail "release.env ausente — rode a fase final primeiro" "$LOG_DIR/release.env" publish
  RELEASE_ID="$(sed -n 1p "$LOG_DIR/release.env")"
  RELEASE_COMMIT="$(sed -n 2p "$LOG_DIR/release.env")"

  # 1) tag imutável (criada FORA do pipeline; sem push automático no two-pass).
  if bash scripts/create-release-tag.sh "$RELEASE_ID" "$RELEASE_COMMIT" > "$LOG_DIR/tag.log" 2>&1; then
    ok "tag $RELEASE_ID -> $RELEASE_COMMIT"
  else
    fail "criação da tag falhou" "$LOG_DIR/tag.log" publish
  fi

  # 2) proveniência remota COM --manifest. Sem a flag o script usa rev-parse HEAD
  #    e qualquer commit posterior ao selo gera RELEASE_TAG_CONFLICT enganoso.
  if node scripts/governance/verify-remote-provenance.js \
      --require-tag --tag "$RELEASE_ID" \
      --manifest "dist/release/$RELEASE_ID.manifest.json" > "$LOG_DIR/provenance.log" 2>&1; then
    ok "proveniência remota: PASS ($(grep -oE 'tagMatches=[a-z]+' "$LOG_DIR/provenance.log" | tail -1))"
  else
    fail "proveniência remota falhou" "$LOG_DIR/provenance.log" publish
  fi

  # 3) recibo de publicação assinado.
  if node scripts/governance/create-release-publication-receipt.js \
      --release "$RELEASE_ID" --tag "$RELEASE_ID" > "$LOG_DIR/receipt.log" 2>&1; then
    ok "recibo de publicação: $(grep -oE 'PUBLISHED_[A-Z_]+' "$LOG_DIR/receipt.log" | tail -1)"
  else
    fail "recibo de publicação falhou" "$LOG_DIR/receipt.log" publish
  fi

  # 4) verificação do recibo contra o pacote publicado.
  if timeout 600 npm run verify:release-publication -- --release "$RELEASE_ID" > "$LOG_DIR/publication.log" 2>&1; then
    local n
    n="$(grep -c 'PASS' "$LOG_DIR/publication.log")"
    ok "verify:release-publication: $n checks PASS"
  else
    fail "verify:release-publication falhou" "$LOG_DIR/publication.log" publish
  fi

  commit_and_push "chore(governance): publicação verificada de $RELEASE_ID" || \
    fail "falha ao commitar/pushar a fase publish" "$LOG_DIR/publication.log" publish
}

# ── Fase 4: consolidate — RECONCILIAÇÃO (pré-certificação) -------------------
# A varredura agregada roda AQUI (e não depois da certificação) porque ela clobbera
# o lineage de experience-segregation e invalida a projeção de jornada — as duas
# reparações rodam imediatamente em seguida, na mesma fase. Esta fase RECONCILIA;
# ela não certifica nem verifica a entrega (fases `certify` e `verify-delivery`).
phase_consolidate() {
  step consolidate "varredura agregada + reparos (journey/stamp) — reconciliação"

  # GUARD: reavalia o TTL do smoke contínuo IMEDIATAMENTE antes do agregado.
  #
  # MEDIDO em 2026-10-05: o preflight valida a idade do smoke na ENTRADA da
  # execução; o ciclo completo leva ~1,5 h, e a evidência (TTL 48 h) venceu
  # DURANTE o candidate/final. O agregado então reprovou em
  # `validate:qa-governance` (qa_waves_continuous_smoke_degraded) depois de
  # ~25 min de varredura — e a única saída era renovar o smoke e repetir a fase.
  # Reavaliar aqui troca 25 min de falha tardia por falha imediata com o remédio,
  # sem afrouxar nada: TTL vencido ⇒ o ciclo PARA.
  local consolidate_qa_state consolidate_qa_rc
  consolidate_qa_state="$(node "$ROOT/scripts/governance/qa-waves-scheduled-ttl-preflight.js" 2>&1)"
  consolidate_qa_rc=$?
  if [ "$consolidate_qa_rc" != "0" ]; then
    warn "smoke contínuo das QA Waves FORA da validade no início do consolidate"
    printf '%s\n' "$consolidate_qa_state" | tail -6 | sed 's/^/    /'
    fail "QA_WAVES_SCHEDULED_EVIDENCE_STALE no consolidate — o TTL venceu durante o ciclo; renove o smoke agendado e retome com --from consolidate"
  fi

  # GUARD (mesma classe): reavalia o TTL da evidência de runtime do Ask-AI antes
  # do agregado.
  #
  # MEDIDO em 2026-10-15: o ciclo inteiro rodou (QA Mesh, empacotamento, tag
  # publicada) e o agregado reprovou com `ASK_AI_RUNTIME_EVIDENCE_STALE` (177,8 h
  # de 168 h), obrigando a interromper a fase, regenerar a evidência e retomar
  # `--from consolidate`. A checagem troca ~20 min de varredura perdida por falha
  # imediata com o comando exato. Não afrouxa nada: evidência vencida ⇒ o ciclo PARA.
  local consolidate_askai_state consolidate_askai_rc
  consolidate_askai_state="$(node "$ROOT/scripts/governance/ask-ai-runtime-evidence-ttl-preflight.js" 2>&1)"
  consolidate_askai_rc=$?
  if [ "$consolidate_askai_rc" != "0" ]; then
    warn "evidência de runtime do Ask-AI FORA da validade no início do consolidate"
    printf '%s\n' "$consolidate_askai_state" | tail -6 | sed 's/^/    /'
    fail "ASK_AI_RUNTIME_EVIDENCE_STALE no consolidate — renove com o produtor canônico e retome com --from consolidate"
  fi

  # GUARD: regenera as evidências de TTL curto ANTES do agregado.
  #
  # MEDIDO em 2026-10-13 (ciclo de ~1h30): o `consolidate` roda o agregado no FIM,
  # mas dois validadores dependem de evidência gerada no INÍCIO do ciclo —
  # `validate:governance-summary` reprovou com `replayIntegrity: STALE` (33 min) e
  # `validate:security-release-gate` reprovou com `SECURITY_GATE_STALE_EVIDENCE`
  # (exit 3: SBOM ANTERIOR ao `startedAt` do run). O ciclo sabotava a si mesmo e a
  # saída eram DUAS retomadas manuais.
  #
  # Diferente do smoke contínuo (que exige renovação EXTERNA e por isso só pode
  # falhar aqui), estas duas evidências têm produtor determinístico e local:
  # regenerar é a ação correta. Não afrouxa nada — o script confere o frescor
  # DEPOIS e sai != 0 se continuar fora de validade.
  node "$ROOT/scripts/governance/refresh-short-ttl-evidence.js" > "$LOG_DIR/short-ttl.log" 2>&1
  if [ $? -ne 0 ]; then
    tail -6 "$LOG_DIR/short-ttl.log" | sed 's/^/    /'
    fail "evidência de TTL curto fora de validade no início do consolidate — agregado abortaria depois de ~25 min" "$LOG_DIR/short-ttl.log" consolidate
  fi
  ok "evidências de TTL curto regeneradas (replay-governance + SBOM)"

  local alog="$LOG_DIR/aggregate.log"
  timeout 3000 npm run validate:governance-enforcement > "$alog" 2>&1
  local rc=$?
  if [ "$rc" = "0" ]; then
    ok "gate agregado: EXIT 0"
  else
    warn "gate agregado EXIT $rc — reparando clobber e repetindo"
    grep -E '❌|\[governance\].*FAIL' "$alog" | head -5 | sed 's/^/    /' || true
  fi

  # Reparo 1: projeção de jornada (o packaging regenerou os inputs de cobertura).
  timeout 300 npm run journey:projections > "$LOG_DIR/journey.log" 2>&1 && \
    ok "projeções de jornada regeneradas" || warn "journey:projections falhou"

  # Reparo 2: lineage dos relatórios que os gates regeneram sem lineage.
  node scripts/governance/stamp-report-lineage.js > "$LOG_DIR/stamp.log" 2>&1 && \
    ok "lineage re-stampado" || warn "stamp-report-lineage falhou"

  # Reexecuta o agregado só se ele falhou, para confirmar o reparo.
  if [ "$rc" != "0" ]; then
    timeout 3000 npm run validate:governance-enforcement > "$alog" 2>&1
    rc=$?
    if [ "$rc" != "0" ]; then
      # BLOQUEANTE (2026-09-19, task T4): antes isto era 'warn' e o seal
      # continuava com o agregado vermelho — foi assim que
      # QA_EVIDENCE_SAME_RUN_VIOLATION (sameRunOk 0/6) seguiu adiante. Gate
      # agregado falho após os reparos ABORTA o ciclo.
      grep -oE 'QA_EVIDENCE_[A-Z_]+' "$alog" | sort -u | sed 's/^/    violação: /' || true
      fail "gate agregado ainda EXIT $rc após reparos — seal ABORTADO (evidência same-run/lineage exige reexecução real, não carimbo)" "$alog" consolidate
    fi
    ok "gate agregado após reparo: EXIT 0"
  fi

  # Persiste a reconciliação ANTES de certificar: a fase seguinte declara sobre um
  # estado limpo e a retomada (`--from <fase>`) exige worktree limpo.
  commit_and_push "chore(governance): reconciliação do ciclo de selagem (gate agregado)" || \
    fail "falha ao commitar/pushar a reconciliação" "$alog" consolidate
}

# ── Fase 5: certify — CERTIFICAÇÃO PRÉ-PUBLICAÇÃO (P0-3) ─────────────────────
#
# POR QUE ESTA FASE EXISTE, E POR QUE ELA VEM ANTES DE `publish`
# Ordem anterior: prepare → candidate → final → publish → consolidate. Os gates
# obrigatórios (gate agregado, aprovação de deploy, prova de runtime do mcp-research
# e a cadeia criptográfica) rodavam DEPOIS de a TAG já estar publicada. Medido em
# 2026-10-15/16: TRÊS ciclos abortaram no `consolidate` com a tag já no remote, e a
# saída era regenerar evidência e retomar a fase. Publicar antes de certificar
# inverte a autoridade: a tag é a promessa pública de que os gates passaram.
#
# Esta fase contém apenas ASSERTIVAS sobre o estado já congelado (não gera pacote):
# aprovação de deploy, cadeia criptográfica reconstruída e verificada contra os
# BYTES atuais, e a prova de runtime. Só depois de todas passarem é que a fase
# `publish` cria a tag — uma falha aqui IMPEDE a publicação, que é o critério de
# aceite da missão.
phase_certify() {
  # ── Aprovação de deploy do artefato selado ───────────────────────────────
  # `system:deploy` exige um sidecar `<release>.approval.json` com goNoGo=GO.
  # Metadados de aprovação NÃO podem ir no manifest do payload: o hash desse
  # manifest é selado no self-proving-report e o verifier rígido exige
  # igualdade. Sem este passo o artefato selado fica NÃO-DEPLOYÁVEL — foi o que
  # aconteceu em 2026-09-26: o selo passou, a publicação passou e
  # `system:deploy` falhava com
  # `artifact_missing:no_zip_with_audit_passed_and_go_no_go_go`, porque o
  # `qa/release-manifest.json` vigente ainda era de 2026-09-08.
  # Roda DEPOIS das reparações de projeção/lineage (fase anterior) porque go/no-go
  # regenera artefatos derivados; o `commit_and_push` logo abaixo persiste o
  # resultado e a fase `verify-delivery` é o juiz fail-closed de que o estado final
  # continua íntegro.
  step certify "aprovação de deploy do artefato selado"
  if timeout 900 npm run system:go-no-go > "$LOG_DIR/go-no-go.log" 2>&1 \
    && timeout 900 npm run system:release-manifest > "$LOG_DIR/release-manifest.log" 2>&1; then
    # Estado da fase `final` (release.env) ou, se perdido (reboot limpa /tmp), o
    # nome derivado do envelope — falha DIAGNÓSTICA, nunca culpando o artefato.
    local release_name=""
    release_name="$(resolve_release_name || true)"
    if [ -z "$release_name" ]; then
      fail "estado do release indisponível: release.env ausente e dist/release sem envelope único — rode a fase final primeiro" "$LOG_DIR/release-manifest.log" certify
    fi
    local approval="dist/release/${release_name}.approval.json"
    if [ -n "$release_name" ] && [ -f "$approval" ] && node -e "
      const a = require('./$approval');
      process.exit(a.goNoGo === 'GO' && a.approvedForDeploy === true ? 0 : 1);
    " 2>/dev/null; then
      ok "aprovação de deploy: $(basename "$approval") (goNoGo=GO, approvedForDeploy=true)"
    else
      fail "artefato selado sem aprovação de deploy válida — system:deploy ficaria bloqueado (artifact_missing:no_zip_with_audit_passed_and_go_no_go_go)" "$LOG_DIR/release-manifest.log" certify
    fi
  else
    fail "falha ao gerar a aprovação de deploy (system:go-no-go / system:release-manifest)" "$LOG_DIR/release-manifest.log" certify
  fi

  # ── CERTIFICAÇÃO DA CADEIA CRIPTOGRÁFICA (P0-2) ─────────────────────────────
  #
  # DEFEITO MEDIDO (2026-10-16): a cadeia (`governance/governance-chain.json` — 10
  # camadas, cada uma com o hash dos BYTES de um membro) é construída na fase
  # `final`, dentro do two-pass. O `consolidate` reescreve 4-5 desses membros DEPOIS
  # disso: `system:go-no-go` (→ platform-readiness) regrava
  # `evidence-manifest.json`, `final-proof-report.json`, `final-readiness-report.json`
  # e `package-validation-report.json`; `materialize-proof-artifacts` regrava
  # `proof-signature.json`. Nenhum passo reconstruía a cadeia aqui, então TODO ciclo
  # terminava com a cadeia estruturalmente INVÁLIDA:
  # `governance-chain.js --verify` acusava 9 divergências (hash_mismatch ×5,
  # cumulative_hash_broken ×3, chain_root_mismatch ×1) — e o único gate que recomputa
  # (`validate:governance-chain`) não estava em nenhum lugar do pipeline. A
  # verificação existia e ninguém a executava.
  #
  # A reconstrução usa o caminho SANCIONADO (`governance/sign-governance.js` →
  # `preSign`: buildChain + atestação ligada à raiz definitiva + assinaturas), nunca
  # um "conserto" manual da cadeia. `--env-file-if-exists=.env` é OBRIGATÓRIO: sem
  # ele o `deriveGovernanceKey` fica sem a raiz de assinatura e o preSign aborta com
  # `REPLAY_SIGNING_KEY_REQUIRED` DEPOIS de gravar a cadeia — deixando o par
  # cadeia↔atestado divergente, pior que não rodar (medido).
  step certify "congela e certifica a cadeia criptográfica (raiz definitiva)"
  if node --env-file-if-exists=.env governance/sign-governance.js > "$LOG_DIR/chain-sign.log" 2>&1; then
    ok "cadeia reconstruída e assinada ($(grep -oE 'chainRoot=[0-9a-f]{16}' "$LOG_DIR/chain-sign.log" | tail -1))"
  else
    fail "reconstrução/assinatura da cadeia falhou — o selo não certifica uma cadeia inválida" "$LOG_DIR/chain-sign.log" certify
  fi

  # O sign-governance grava o atestado em `dist/governance-artifacts/`; a cópia do
  # workspace (lida pelo self-proving) ficaria apontando para a raiz ANTIGA. Mesma
  # propagação do two-pass — uma regra só, sem implementação paralela.
  for src in "$ROOT/dist/governance-artifacts/governance-attestation.json" "$ROOT/dist/governance-attestation.json"; do
    if [ -f "$src" ]; then
      cp "$src" "$ROOT/governance/governance-attestation.json"
      ok "atestado propagado para o workspace (ligado à raiz definitiva)"
      break
    fi
  done

  # O gate RECALCULA os bytes atuais e compara com a cadeia gravada. Bloqueante: uma
  # cadeia que não fecha significa que algum documento certificado mudou depois do
  # hash — exatamente a classe de defeito que este bloco existe para impedir.
  local clog="$LOG_DIR/chain-verify.log"
  if node scripts/governance/validate-governance-chain.js > "$clog" 2>&1; then
    ok "cadeia verificada: $(grep -oE 'status=[A-Z_]+' "$clog" | tail -1)"
  else
    fail "cadeia criptográfica INVÁLIDA após a certificação — os hashes não correspondem à raiz definitiva" "$clog" certify
  fi

  # ASSERTIVA CANÔNICA (P0-4): a pergunta que a PUBLICAÇÃO exige não é "algum gate
  # disse GO?", e sim "este artefato está em GO DEFINITIVO segundo a autoridade
  # única?". Os gates checavam isso com vocabulários próprios, e estado pré-pacote
  # (`PASS_WITH_DEFERRED_PACKAGE_GATE`, `AUTONOMOUS_READY` sem `_GO`) passava como
  # aprovado em três consumidores medidos. Aqui a resposta vem de um lugar só
  # (`governance/canonical-release-decision.js`), sobre os artefatos REAIS do selo,
  # com versão do vocabulário e checagem de identidade: GO de outro candidato não vale.
  # Bloqueante — sem GO definitivo, a fase `publish` nem começa.
  local dlog="$LOG_DIR/canonical-decision.log"
  if node --env-file-if-exists=.env scripts/governance/assert-canonical-release-decision.js > "$dlog" 2>&1; then
    ok "decisão canônica: $(tail -1 "$dlog")"
  else
    fail "artefato selado NÃO está em GO definitivo — a publicação fica impedida (cadeia: decisão canônica P0-4)" "$dlog" certify
  fi

  # MCP_RESEARCH_DOCKER_E2E: no agregado o gate sai 0 com REQUIRES_DOCKER_RUNTIME
  # quando não há docker — correto para CI/dev, mas não é prova de release. Aqui
  # o relatório tem de estar PASS e FRESCO (o agregado acabou de rodar o gate).
  if node scripts/governance/verify-mcp-research-docker-e2e-pass.js > "$LOG_DIR/mcp-e2e.log" 2>&1; then
    ok "MCP_RESEARCH_DOCKER_E2E: relatório PASS fresco"
  else
    fail "MCP_RESEARCH_DOCKER_E2E não verde (release final não existe sem a prova de runtime)" "$LOG_DIR/mcp-e2e.log" certify
  fi

  # A certificação termina persistindo o resultado. A fase `publish` cria a tag
  # sobre ESTE estado; a retomada (`--from certify`) exige worktree limpo.
  commit_and_push "chore(governance): certificação final do ciclo de selagem" || \
    fail "falha ao commitar/pushar a certificação" "$alog" certify
}

# ── Fase 7: verify-delivery — CONFIRMAÇÃO DE ENTREGA (pós-publicação) ────────
#
# Deliberadamente SEPARADA da certificação (P0-3): a certificação afirma sobre o
# artefato ANTES de publicar; esta fase confirma o ENTREGUE depois. Amarrar as duas
# foi o defeito — uma falha de gate ocorria com a tag já no remote. Aqui só rodam
# verificações (mais o repasse de lineage, que é reparo de metadado): nada capaz de
# reabrir a decisão de certificar.
phase_verify_delivery() {
  # Etapa final: verificação do release entregue. Nada de rodar o agregado depois.
  local vlog="$LOG_DIR/verify-final.log"
  timeout 900 npm run verify:delivered-release > "$vlog" 2>&1
  if grep -qE 'DELIVERED_RELEASE_VERIFIED|DELIVERED_PENDING_SCORECARD' "$vlog"; then
    ok "verify:delivered-release: $(grep -oE 'DELIVERED_[A-Z_]+' "$vlog" | tail -1)"
  else
    warn "verify:delivered-release falhou — repetindo o reparo de lineage"
    node scripts/governance/stamp-report-lineage.js > "$LOG_DIR/stamp2.log" 2>&1
    git add -A >/dev/null 2>&1
    git commit -q -m "fix(governance): re-stampa lineage clobberado pela varredura agregada" >/dev/null 2>&1
    git push origin main -q >/dev/null 2>&1
    timeout 900 npm run verify:delivered-release > "$vlog" 2>&1
    if grep -qE 'DELIVERED_RELEASE_VERIFIED|DELIVERED_PENDING_SCORECARD' "$vlog"; then
      ok "verify:delivered-release: reparado"
    else
      fail "verify:delivered-release falhou após reparo" "$vlog" verify-delivery
    fi
  fi

  # FECHO DA CERTIFICAÇÃO (P0-2): o requisito é "qualquer alteração POSTERIOR ao
  # congelamento provoca NO_GO". Como o gate recalcula os BYTES atuais, reexecutá-lo
  # no último ponto do ciclo prova que nada — nem o `verify:delivered-release`, nem o
  # repasse de lineage logo acima — mexeu em documento certificado. Sem este fecho, a
  # certificação seria uma promessa, não uma verificação.
  local clogf="$LOG_DIR/chain-verify-final.log"
  if node scripts/governance/validate-governance-chain.js > "$clogf" 2>&1; then
    ok "cadeia íntegra no fecho (nada alterado após o congelamento)"
  else
    fail "documento certificado foi MODIFICADO depois do congelamento — cadeia inválida no fecho do ciclo" "$clogf" verify-delivery
  fi

  echo
  cyan "╔══════════════════════════════════════════════════════════════╗"
  cyan "║  CICLO DE SELAGEM CONCLUÍDO                                  ║"
  cyan "╚══════════════════════════════════════════════════════════════╝"
  if [ -f "$LOG_DIR/release.env" ]; then
    echo "  Release : $(sed -n 1p "$LOG_DIR/release.env")"
    echo "  Commit  : $(sed -n 2p "$LOG_DIR/release.env")"
    echo "  H_final : $(sed -n 3p "$LOG_DIR/release.env")"
  fi
  echo "  Score   : $(node -e "const j=require('./reports/governance-score.json');console.log(j.status+'/'+j.overallGovernance)" 2>/dev/null || echo n/d)"
  echo "  Logs    : $LOG_DIR"
}

# ── Execução ----------------------------------------------------------------
preflight

if [ "$DRY_RUN" = "1" ]; then
  echo
  cyan "PLANO (dry-run)"
  echo "  pré-requisito   evidência de smoke contínuo das QA Waves dentro do TTL"
  echo "                  (vencida => validate:qa-governance ABORTA o agregado na fase 5)"
  echo "  1. prepare      create-governed-run (se drift) -> converge -> QA Mesh REAL no run (canônico, ~35min;"
  echo "                 falha do mesh ABORTA) -> exige SEAL_PENDING|SEAL_GO -> commit+push"
  echo "  2. candidate    zip:release (exit 1 esperado) -> verify:delivered-release -> scorecard below10=0"
  echo "                 -> projeções PASS -> fixpoint -> commit+push"
  echo "  3. final        zip:release (exit 0) -> release/commit/H_final do MANIFEST -> commit no remote"
  echo "  4. consolidate  gate agregado (BLOQUEANTE: exit != 0 após reparos ABORTA o seal)"
  echo "                 -> journey:projections -> stamp-report-lineage -> commit+push"
  echo "  5. certify      CERTIFICAÇÃO PRÉ-PUBLICAÇÃO (falha aqui IMPEDE a criação da tag)"
  echo "                 -> aprovação de deploy: go-no-go + release-manifest (sidecar com goNoGo=GO)"
  echo "                 -> cadeia criptográfica reconstruída + verificada contra os bytes atuais (BLOQUEANTE)"
  echo "                 -> MCP_RESEARCH_DOCKER_E2E exige relatório PASS fresco (BLOQUEANTE)"
  echo "  6. publish      create-release-tag -> verify-remote-provenance --manifest -> recibo -> publication"
  echo "  7. verify-delivery  verify:delivered-release (juiz fail-closed da ENTREGA, pós-publicação)"
  echo "                 -> fecho: cadeia reconferida (alteração pós-congelamento => NO_GO)"
  echo
  echo "  Fases: ${PHASES[*]}"
  echo "  A partir de: $FROM_PHASE"
  exit 0
fi

# `verify-delivery` é o nome canônico da fase e NÃO é um identificador bash válido
# (hífen). O despacho é explícito, nunca por `phase_$phase`: a expansão falharia com
# "command not found" e o ciclo terminaria SEM a verificação final — o pior desfecho
# possível (declarar concluído sem verificar a entrega).
dispatch_phase() {
  case "$1" in
    prepare)         phase_prepare ;;
    candidate)       phase_candidate ;;
    final)           phase_final ;;
    consolidate)     phase_consolidate ;;
    certify)         phase_certify ;;
    publish)         phase_publish ;;
    verify-delivery) phase_verify_delivery ;;
    *) return 1 ;;
  esac
}

STARTED=0
for phase in "${PHASES[@]}"; do
  if [ "$phase" = "$FROM_PHASE" ]; then STARTED=1; fi
  [ "$STARTED" = "1" ] || { warn "pulando fase $phase"; continue; }
  dispatch_phase "$phase" || { bad "fase sem implementação: $phase"; echo "  válidas: ${PHASES[*]}"; exit 2; }
done

[ "$STARTED" = "1" ] || { bad "fase desconhecida: $FROM_PHASE"; echo "  válidas: ${PHASES[*]}"; exit 2; }
