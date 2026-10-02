#!/usr/bin/env bash
# converge-governance.sh — converge o estado canônico de governança para o run
# governado ATUAL (governance/.current-run.json).
#
# Quando usar: após qualquer commit que toque as raízes-fonte do fingerprint
# (api/, scripts/governance/, governance/proof-engine/, qa/contracts etc.) —
# ou seja, após RUN_SOURCE_DRIFT. Sequência canônica:
#
#   1. git commit (worktree limpa — release oficial exige DIRTY_WORKTREE=0)
#   2. node scripts/governance/create-governed-run.js   (congela o fingerprint)
#   3. bash scripts/governance/converge-governance.sh   (este script)
#   4. git commit dos artefatos regenerados
#   5. npm run zip:release
#
# PRÉ-REQUISITO DE RUNTIME (2026-09-20): a evidência RUNTIME_EVIDENCE
# (qa-mesh/* e qa/enterprise/*) só é prova do run se EXECUTAR dentro dele —
# este script precisa de uma API viva em TEST_BASE_URL (default
# http://localhost:3001) com as credenciais TEST_USERNAME/TEST_PASSWORD.
#
# O que este script faz (tudo derivado de evidência real, nada sintético):
#   - executa o enterprise proof smoke DENTRO do run (artefatos
#     qa/enterprise/{human-handoff,pbx-voice-flow,omnichannel-unified-replay}
#     nascem com o lineage do run corrente — ver T15). ORDEM: antes do
#     critical-journey, que consome o handoff;
#   - regenera artefatos cujo produtor é externo ao fixpoint (jornada crítica,
#     qa-waves enterprise, package-validation do zip de convergência);
#   - regenera a projeção de readiness (produtor externo ao fixpoint) para que
#     ela carregue o runId CORRENTE — sem isso `dev/platform-readiness/latest.json`
#     fica com lineage estrangeiro e o contamination cleaner derruba o run
#     (FOREIGN_RUN_ARTIFACT em arquivo de decisão);
#   - REGERA os relatórios derivados com validade temporal (maxAgeMs=7d no
#     registry): system-scope-audit, agent-policy-compliance e
#     replay-hardening. O stamp NÃO pode refrescar generatedAt (seria freshness
#     fabricada) — só o produtor real pode. Sem este passo os relatórios cruzam
#     168h e o scorecard derruba as dimensões dependentes (ARTIFACT_EXPIRED,
#     medido em 2026-09-20 no run rap-governed-20260920040310055);
#   - REGERA a evidência executável com validade temporal: master-scorecard
#     test/regression, reports de domínio e o relatório de persistência, e
#     executa o QA MESH canônico DENTRO do run (RUNNING_IN_PIPELINE=1 →
#     executionOrigin=pipeline; lineage resolvido na origem por
#     pipeline/entrypoints/runQaMesh.js). ORDEM OBRIGATÓRIA: o mesh roda ANTES
#     do stamp e do scorecard — em 2026-09-20 o seal-time-gate avaliou o run
#     novo antes do mesh executar e RAP-024/026 caíram como
#     FOREIGN_RUN_ARTIFACT (falha "real") → SEAL_NO_GO com o mesh nunca
#     executado (deadlock). ATENÇÃO: as suítes Jest reescrevem relatórios
#     governados sem lineage (coverage/model-driven) — por isso o stamp é o
#     passo SEGUINTE, nunca o anterior;
#   - re-stampa lineage (runId/sourceFingerprint) nos relatórios governados;
#   - roda o fixpoint persistido 2x (1ª: projeta DEFERRED a partir do DB;
#     2ª: revalida contra os relatórios projetados — fixpoint estável);
#   - avalia o seal-time-gate (esperado: SEAL_PENDING na fase DELIVERED ou
#     SEAL_GO quando 78/78).
set -euo pipefail
cd "$(dirname "$0")/../.."

# ── CARGA ÚNICA DO .env (mesmo contrato de scripts/governance/lib/loadEnvFile.js: o ambiente já
#    presente VENCE) ──────────────────────────────────────────────────────────────────────────
# DEFEITO REAL medido em 2026-10-02: o PREFLIGHT abaixo lê variáveis de SHELL
# (PBX_CALL_EVENTS_RUNTIME_INSERT_MODE, entre outras) e NADA as populava. O `.env` tinha
# `PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct` e o preflight reprovava com "!= direct" (o smoke
# L-04 tentaria um serviço de compose inexistente neste runtime e a etapa 1/12 abortaria), então a
# fase `prepare` do `release:seal` ABORTAVA SEMPRE que o selo era invocado de um shell comum: o
# veredito dependia de QUEM INVOCA — o mesmo defeito que `loadEnvFile.js` já documenta para os
# coletores Node. Os comandos Node aqui já usavam `--env-file-if-exists=.env`; agora a camada bash
# vê o MESMO ambiente.
# `set -a` NÃO é usado de propósito: exportar tudo sobrescreveria o que o operador exportou de
# forma explícita, que é justamente o que o contrato promete preservar.
if [ -f .env ]; then
  while IFS= read -r _env_line || [ -n "$_env_line" ]; do
    case "$_env_line" in ''|'#'*) continue ;; esac
    _env_key="${_env_line%%=*}"
    case "$_env_key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    _env_val="${_env_line#*=}"
    # espelha o strip de quotes do loadEnvFile.js
    case "$_env_val" in
      \"*\") _env_val="${_env_val#\"}"; _env_val="${_env_val%\"}" ;;
      \'*\') _env_val="${_env_val#\'}"; _env_val="${_env_val%\'}" ;;
    esac
    if [ -z "${!_env_key+x}" ]; then
      export "$_env_key=$_env_val"
    fi
  done < .env
  unset _env_line _env_key _env_val
fi

NODE="node --env-file-if-exists=.env"

# ── PREFLIGHT (fail-fast de ambiente) ────────────────────────────────────────
# Defeito medido (2026-09-23): três falhas reais de AMBIENTE só apareceram DEPOIS
# do mesh (etapa 1/12, 8.5/12 e 2.9 do empacotamento), custando 30-50 min de
# ciclo perdido cada uma:
#   (a) rag-service fora do ar -> relatório RAG UNREACHABLE -> coverage gate NO_GO;
#   (b) `vite preview` na 5173 em vez do dev server -> `GET /workspace` = 404
#       (o plugin `frontend-routes` só existe em `configureServer`/DEV) -> todos os
#       seeds `fitness-matricula-*` travam 10 min x 2;
#   (c) `/etc/asterisk` do container é tmpfs populado só no start, então o
#       `tenants.conf` regerado no host nunca entra em vigor sem restart ->
#       `Local/9191@<tenant>` sem dialplan -> chamada não atendida -> sem CDR.
# Este bloco custa segundos e converte cada uma dessas em mensagem acionável.
preflight() {
  local fail=0
  local api_url="${TEST_BASE_URL:-${TEST_API_URL:-${API_URL:-http://localhost:3001}}}"
  local frontend_url="${TEST_FRONTEND_URL:-${FRONTEND_URL:-http://localhost:5173}}"
  local rag_url="${RAG_SERVICE_URL:-http://localhost:8001}"

  _ok()   { echo "  ✓ $1"; }
  _bad()  { echo "  ✗ $1" >&2; fail=1; }

  echo "[preflight] validando runtime obrigatório (API, frontend SPA, RAG, PBX, dist)"

  if curl -sf -m 10 -o /dev/null "${api_url}/health"; then _ok "API viva em ${api_url}"
  else _bad "API não responde em ${api_url}/health — suba 'node api/server.js' (repo root)"; fi

  # nodemon observa `api`,`engine`,`src`,`qa-mesh`: qualquer escrita nessas
  # árvores no meio do mesh reinicia a API e o cenário morre com
  # `fetch failed (cause: UND_ERR_SOCKET)` (medido 2026-09-24 no
  # business-core-biz-flows-editor). Aviso, não falha: o supervisor é útil em dev.
  if pgrep -f "nodemon api/server.js" >/dev/null 2>&1 || pgrep -f "nodemon.*api" >/dev/null 2>&1; then
    echo "  ⚠ API supervisionada por nodemon — reinício no meio do run causa UND_ERR_SOCKET; para o ciclo de governança rode 'node --env-file-if-exists=.env api/server.js' direto"
  else
    _ok "API sem supervisor (sem reinício acidental)"
  fi

  # A rota canônica `/workspace` precisa ser servida pelo FRONTEND. Em
  # `vite preview` ela é proxyada para a API e volta 404 (`x-api-route-fallback`).
  local ws_code
  ws_code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' -H 'Accept: text/html,application/xhtml+xml' "${frontend_url}/workspace" || echo 000)"
  if [ "$ws_code" = "200" ]; then _ok "frontend servindo /workspace em ${frontend_url}"
  else _bad "GET ${frontend_url}/workspace devolveu ${ws_code} — use o DEV server ('npm run dev:frontend' na 5173); 'vite preview' NÃO serve rotas SPA (plugin frontend-routes só existe em DEV) e faz os seeds fitness-matricula-* travarem"; fi

  if curl -sf -m 10 -o /dev/null "${rag_url}/health"; then _ok "rag-service vivo em ${rag_url}"
  else _bad "rag-service não responde em ${rag_url}/health — sem ele o relatório de segregação fica UNREACHABLE e o coverage gate (8.5/12) reprova"; fi

  if [ "${PBX_CALL_EVENTS_RUNTIME_INSERT_MODE:-}" = "direct" ]; then _ok "PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct"
  else _bad "PBX_CALL_EVENTS_RUNTIME_INSERT_MODE != direct — o smoke L-04 tenta 'docker compose -f docker-compose.test.yml exec api' (serviço inexistente aqui) e a etapa 1/12 aborta"; fi

  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qF "${PBX_ODBC_PORT:-15432}"; then _ok "ponte host<->Asterisk escutando (${PBX_ODBC_PORT:-15432})"
  else _bad "ponte host<->Asterisk ausente — rode 'set -a && . ./.env && set +a && bash scripts/pbx-host-db-bridge.sh start' (sem ela o CDR do Asterisk nunca chega ao banco da API)"; fi

  # tmpfs do Asterisk: o container copia /etc/asterisk-static SÓ no start; se o
  # tenants.conf do host for mais novo, o contexto de tenant não está em vigor.
  local host_tc="pbx/asterisk/etc/asterisk/conf/tenants.conf"
  if [ -f "$host_tc" ] && command -v docker >/dev/null 2>&1; then
    if docker exec chatbot-asterisk sh -c 'test -f /etc/asterisk/conf/tenants.conf' 2>/dev/null; then
      local host_mtime cont_mtime
      host_mtime="$(stat -c %Y "$host_tc" 2>/dev/null || echo 0)"
      cont_mtime="$(docker exec chatbot-asterisk stat -c %Y /etc/asterisk/conf/tenants.conf 2>/dev/null || echo 0)"
      if [ "$cont_mtime" -ge "$host_mtime" ]; then _ok "tenants.conf em vigor no Asterisk"
      else _bad "tenants.conf do container é MAIS ANTIGO que o do host — rode 'docker restart chatbot-asterisk' (o tmpfs só é repovoado no start; 'dialplan reload' não relê o arquivo do host)"; fi
    else
      _bad "container chatbot-asterisk sem /etc/asterisk/conf/tenants.conf"
    fi
  else
    echo "  ⚠ validação do dialplan de tenants pulada (host_tc ou docker indisponível)"
  fi

  # dist/: ZIP de ciclo anterior sem correspondente em archive/ = sobra que já
  # fez o package-validator ler o ZIP errado (PASS 2.9) e abortar a release.
  # dist/: sobras de ciclo anterior fazem o empacotamento ler o artefato ERRADO
  # (medido 2026-09-24: artifact_manifest_invalid "Unexpected token 'P', \"PK\""
  # porque o package-validator recebeu o ZIP do ciclo anterior — um ciclo inteiro
  # perdido, duas vezes). O check cobre raiz, release/ e candidate/.
  local leftover=""
  leftover="$(ls dist/r-agent2-*.zip 2>/dev/null | head -1 || true)"
  if [ -z "$leftover" ]; then
    leftover="$(ls dist/release/*.payload.zip 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$leftover" ]; then
    leftover="$(ls dist/candidate/* 2>/dev/null | head -1 || true)"
  fi
  if [ -n "$leftover" ]; then
    _bad "dist/ tem sobra de ciclo anterior ($leftover) — limpe o estado transitório (dist/r-agent2-*.zip, dist/*.manifest.json, dist/release/*, dist/candidate/*, dist/governance-artifacts/) preservando dist/archive/ e dist/engineering-router-v1-audit-envelope/, ou o empacotamento lê o pacote errado"
  else
    _ok "dist/ sem sobras de ciclo anterior"
  fi

  if [ "$fail" -ne 0 ]; then
    echo "[preflight] FALHOU — corrija os itens acima antes de rodar a convergência (evita perder um ciclo de ~40 min)" >&2
    exit 1
  fi
  echo "[preflight] OK"
}

# ── DRIFT GUARD (same-run é obrigatório) ─────────────────────────────────────
# Defeito medido (2026-09-24): a convergência descobria RUN_SOURCE_DRIFT DEPOIS
# do mesh (etapa 8/12, ~30 min). O selador então criava um run novo do
# fingerprint atual e re-executava tudo — queimando um mesh inteiro por nada.
# Aqui a comparação acontece ANTES de qualquer evidência e de novo imediatamente
# antes do mesh, com o MESMO marcador que o selador já reconhece
# (grep 'RUN_SOURCE_DRIFT'), então a recuperação automática continua valendo —
# só que sem perder o mesh.
drift_guard() {
  local current run_fp
  current="$(node -e "const {computeSourceFingerprint}=require('./governance/proof-engine/fingerprint-chain');process.stdout.write(String(computeSourceFingerprint(process.cwd())))" 2>/dev/null || true)"
  run_fp="$(node -e "try{const r=require('./governance/.current-run.json');process.stdout.write(String(r.sourceFingerprint||''))}catch(_){}" 2>/dev/null || true)"
  if [ -z "$current" ] || [ -z "$run_fp" ]; then
    echo "[drift-guard] ⚠ não foi possível resolver fingerprint/run governado — seguindo com os gates" >&2
    return 0
  fi
  if [ "$current" != "$run_fp" ]; then
    echo "[drift-guard] RUN_SOURCE_DRIFT: source atual ${current:0:16}… != run ${run_fp:0:16}…" >&2
    echo "[drift-guard] evidência same-run exige run do fingerprint atual: rode 'node scripts/governance/create-governed-run.js' e reexecute a convergência (o selador faz isso automaticamente ao ler este marcador)." >&2
    exit 1
  fi
  echo "[drift-guard] run governado vinculado ao source atual (${current:0:16}…)"
}

preflight
drift_guard

echo "[converge] 1/12 enterprise proof smoke DENTRO do run (evidência same-run qa/enterprise/*)"
# RUNTIME_EVIDENCE: só é prova do run se executar nele. O smoke resolve o
# lineage NA ORIGEM (governance/.current-run.json) e sai != 0 quando
# report.ok=false — fail-closed, sem evidência same-run não há convergência.
RUNNING_IN_PIPELINE=1 $NODE scripts/smoke/qa-waves-enterprise-proof-smoke.js

echo "[converge] 2/12 critical-journey-evidence (v2 — evidência real de handoff)"
$NODE scripts/governance/generate-critical-journey-evidence-v2.js

echo "[converge] 3/12 qa-waves enterprise governance (bridge)"
$NODE tools/system/qa-waves-enterprise-governance-bridge.js >/dev/null

echo "[converge] 4/12 package-validation (zip de convergência, se presente)"
CONV_ZIP="$(ls -t dist/r-agent2-converge-provisional.zip 2>/dev/null | head -1 || true)"
if [[ -n "$CONV_ZIP" ]]; then
  $NODE governance/package-validator.js --zip "$CONV_ZIP" --audited-only
else
  # Nenhum ZIP NESTE ciclo ainda. Se NÃO existe pacote algum no disco, o estado
  # honesto da fase é DEFERRED (o pacote ainda não foi construído) — rodar o
  # validator sem --zip faz ele resolver o artefato mais recente e reportar
  # DEFERRED/PRE_PACKAGE. Sem este passo, o relatório fica apontando para o
  # payload do release ANTERIOR (que já não existe em dist/) e o scorecard passa
  # a contar RAP-052/RAP-054 como FALHA REAL — foi assim que o `release:seal`
  # travava na fase prepare com `dist/` zerado (PACKAGE_VALIDATION_NOT_PASS +
  # MASTER_SCORECARD_NOT_10_OF_10 em [RAP-052,RAP-054]).
  if compgen -G "dist/release/*.payload.zip" > /dev/null || compgen -G "dist/r-agent2-*.zip" > /dev/null; then
    echo "[converge]   (pacote presente em dist/ — package-validation fica para o PASS 2.9 do release)"
  else
    echo "[converge]   (nenhum pacote em dist/ — gravando package-validation DEFERRED honesta)"
    $NODE governance/package-validator.js >/dev/null 2>&1 || true
  fi
fi

echo "[converge] 5/12 readiness projection (lineage do run corrente)"
# O exit code deste produtor ESPELHA A DECISÃO (1 quando a decisão não é GO),
# não uma falha de execução. A avaliação da decisão é feita pelo fixpoint
# (passos 10-11); aqui o objetivo é apenas regerar a projeção com o lineage do
# run corrente. Sob `set -e` o abort seria um falso bloqueio.
$NODE tools/system/platform-readiness.js >/dev/null || true

echo "[converge] 6/12 relatórios derivados com TTL de 7d (produtor real, nunca stamp)"
# maxAgeMs=7d no master-scorecard-registry: cruzou 168h vira ARTIFACT_EXPIRED e
# derruba as dimensões dependentes (RAP-007/010/011/012/015/016/017/058/077,
# medido em 2026-09-20). Só o produtor real refresca generatedAt sem fabricar
# freshness. O lineage (runId/fingerprint) é reaplicado no passo 9 (stamp).
$NODE scripts/governance/generate-system-scope-audit.js >/dev/null
$NODE governance/verify-agent-policy-compliance.js >/dev/null
$NODE governance/replay-hardening-engine.js >/dev/null

echo "[converge] 7/12 evidência executável com validade temporal (test/regression + domínios + persistência)"
# Produtores reais (rodam as suítes Jest e gravam o exit code): únicos que
# podem refrescar generatedAt sem fabricar freshness. Se uma suíte falhar, o
# report sai FAIL e o fixpoint/seal-time-gate reprovam — comportamento honesto
# desejado (set -e aborta aqui de propósito). ATENÇÃO: estas suítes reescrevem
# relatórios governados sem lineage (coverage/model-driven) — por isso o stamp
# é o passo SEGUINTE, nunca o anterior.
$NODE scripts/governance/generate-policy-evidence.js
$NODE scripts/governance/generate-domain-evidence.js >/dev/null
$NODE scripts/governance/generate-persistence-evidence.js >/dev/null

# Reavalia o vínculo run<->source IMEDIATAMENTE antes do passo mais caro do
# ciclo: se as etapas 1-7 escreveram algo sob raiz de fingerprint, o mesh não
# pode rodar (a evidência dele nasceria de um run já inválido).
drift_guard

echo "[converge] 8/12 QA Mesh canônico DENTRO do run governado (~35min; evidência same-run RAP-024/026)"
# RUNTIME_EVIDENCE: o go-no-go do mesh só é prova do run em que o mesh
# REALMENTE rodou. RUNNING_IN_PIPELINE=1 torna a execução canônica
# (executionOrigin=pipeline → go-no-go/release-gate/histórico gravados) e o
# lineage é resolvido na origem por pipeline/entrypoints/runQaMesh.js a partir
# de governance/.current-run.json — nunca anexado depois. Exit != 0 (NO_GO ou
# erro) aborta a convergência: sem evidência same-run não há seal.
RUNNING_IN_PIPELINE=1 timeout 5400 npm run qa:mesh

echo "[converge] 8.5/12 coverage gate RECOMPUTADO sobre o mesh do run corrente"
# Os estados de jornada do coverage gate derivam dos outcomes de cenário do
# mesh. Até 2026-09-20 o report era regenerado só no passo 7/12 (via suíte
# coverageGate.test.js), ANTES do mesh do run — o gate avaliava o mesh do run
# ANTERIOR e derrubava RAP-002/018/020/022/023/025/040 por herança (journey
# crítica FAILED no seal#8 → NO_GO no seal#9 com o mesh do run corrente GO,
# medido no run rap-governed-20260920113643242-cac6169c). Aqui o produtor
# real reexecuta DEPOIS do mesh: evidência recomputada do run, nunca stamp.
# Exit != 0 (NO_GO) aborta a convergência — sem cobertura válida não há seal.
$NODE scripts/governance/validate-coverage-gate.js

echo "[converge] 9/12 stamp de lineage"
$NODE scripts/governance/stamp-report-lineage.js >/dev/null

echo "[converge] 10/12 fixpoint (pass 1 — projeção)"
$NODE scripts/governance/run-persisted-scorecard.js >/dev/null

echo "[converge] 11/12 fixpoint (pass 2 — revalidação estável)"
$NODE scripts/governance/run-persisted-scorecard.js

echo "[converge] 12/12 seal-time-gate"
node scripts/governance/seal-time-gate.js
