# FINAL_RELEASE_CLOSURE.md

Missão: FINAL_RELEASE_CLOSURE — selagem definitiva do Engineering Model Router V1
(ER-V1-SEALFIX-001..004) seguida de fechamento oficial de release do RAP inteiro
(governed run novo, QA Mesh same-run, gates obrigatórios, 2 clean releases,
2 offline verifications, reproducibility). Executada sobre a base já fechada em
`ENGINEERING_ROUTER_V1_FINAL_SEAL.md` (5 blockers ER-V1-SEAL-* GREEN).

## BASELINE

```
HEAD=affb570861f1bb3aea3e6c36ebd9258538902610
SOURCE_FINGERPRINT=eec9b0a226093be078c2ab6be68281b5c8e3596d9c55009921ec613ff2070931
STARTED_AT=2026-09-23T05:20:00Z
ROUTER_STRUCTURAL=PASS (162 checks, 0 falhas)
ROUTER_RUNTIME=RUNTIME_NOT_REQUESTED (não pedido nesta chamada; último RUNTIME_PASS real: 25/25, fingerprint=42bb5ee02158f605…, commit=330478f5, anterior ao HEAD atual)
QA_MESH=NO_GO (mesh-20260922234257-5ys1mx; execução mais recente reprova por 1 item flaky em 'core' — investigado exaustivamente na sessão anterior: contenção de CPU sob carga pesada, não regressão de código)
FINAL_CONSISTENCY=UNKNOWN (status=null, run anterior rap-governed-20260920181847967-96783363, stale)
FINAL_READINESS=NO_GO:MANDATORY_GATE_BLOCKED [qa-mesh=NO_GO | release-gate=NO_GO] (run rap-governed-20260922083602035-87410cca, stale, commit a76204e6, 33+ commits atrás do HEAD atual)
GOVERNANCE=PASS (overallGovernance=100, mas gerado em 2026-09-19, anterior a todo o trabalho desta e da missão SEAL anterior — precisa ser regenerado no novo governed run)
CURRENT_RUN_ID=rap-governed-20260922083602035-87410cca (stale — será invalidado e substituído por um novo governed run após o freeze final de source, per FASE RAP GLOBAL)
```

Working tree estava limpo na baseline (após reverter artefatos de relatório de uma
execução de pipeline anterior, não commitada, superada por esta missão).

## Regra da missão respeitada

Nenhuma alteração de hash/proof/report manual para fingir verde. Todo GO só é
declarado com evidência real regenerada.

## Backlog congelado desta fase (4 blockers estruturais do Router)

1. ER-V1-SEALFIX-001 — Artifact-to-Source Binding
2. ER-V1-SEALFIX-002 — Real Container Deployment
3. ER-V1-SEALFIX-003 — Runner Trust Boundary
4. ER-V1-SEALFIX-004 — Phase-Aware Durable Resume

## Blockers

### ER-V1-SEALFIX-001 — Artifact-to-Source Binding

- RED: verifier confirmava consistência interna do envelope (hashes batem entre si) mas nunca
  provava que o CÓDIGO REALMENTE ENTREGUE no pacote é o código certificado.
- fix: `ACTUAL_PACKAGE_SOURCE_FINGERPRINT` recomputado pelo verifier a partir dos arquivos reais
  do pacote (mesmo algoritmo do gerador, nunca `.git`), cruzado contra todos os artifacts com
  `sourceFingerprint`. Suporte a ZIP real (`extractPackageFromZip`, extrai o pacote inteiro).
  Nova autoridade única de seal (`seal-certification.json`) com lineage preservada de
  ER-V1-FINAL-001..010 e ER-V1-SEAL-001..005, nunca conflada com o backlog desta missão.
- tests: 12/12 mandatórios GREEN (byte alterado, source substituído, envelope de outro run,
  sourceFingerprint divergente, runtime evidence de outra fonte, seal evidence ausente, item
  SEALFIX ausente, sem `.git`, offline, diretório extraído, ZIP real, distinção 10/10 FINAL vs
  4/4 SEALFIX).
- commit: `aca93434`.
- status: **GREEN**

### ER-V1-SEALFIX-003 — Runner Trust Boundary

- RED: o runner (único com Docker socket) só validava a FORMA do contrato HTTP — `network`,
  `cwd`, `executable`/`args` e `env` do caller praticamente não eram revalidados antes de
  alcançar `docker run` real.
- fix: `validateNetworkPolicy` (só "none", decidido pelo runner), `validateWorkspaceCwd`
  (`fs.realpathSync` + contenção estrita em `ENGINEERING_ROUTER_WORKSPACE_ROOT`),
  `validateStructuredCommand` (reexportado de `commandPolicy.js`, revalidado no runner),
  `sanitizeExecutionEnv` (allowlist reconstruída do zero), limite de concorrência
  (`maxConcurrentExecutions`, 503 explícito).
- tests: 11/11 adversariais GREEN (network=host, cwd=/etc, escape de workspace, symlink escape,
  executable não autorizado, env com secret descartado, privileged/cap-add/volumes/docker-socket/
  host-pid impossíveis via campo extra, execução válida preservada).
- commit: `54128514`.
- status: **GREEN**

### ER-V1-SEALFIX-004 — Phase-Aware Durable Resume

- RED: `executeRoutedLoop` sempre recomeçava do zero em CODING após um restart de PROCESSO,
  mesmo com REGRESSION/GOVERNANCE/PROMOTING (efeito IRREVERSÍVEL)/POST_PROMOTION_VERIFY já
  persistidos de verdade — `operationService` (ER-V1-SEAL-002) nunca era alcançado de novo.
- fix: `advanceFromCodedAttempt` extraído para ser reentrante; `resumeAdvancePhaseIfNeeded`
  detecta e retoma antes de criar tentativa nova; `enterAdvancePhase`/`ADVANCE_PHASE_ORDER`
  evita transição para trás numa retomada mais adiantada; tentativa presa em CODING/TESTING/
  REVIEWING (sem efeito irreversível) marcada `ABANDONED` explicitamente, nunca em silêncio. Bug
  real encontrado pelos próprios testes: `findExistingCandidate` não devolvia
  `validatedTreeHash`, quebrando `verifyPromotedCandidate` numa retomada real — corrigido.
- tests: 5/5 cenários de crash real (Postgres real, API pública `runTask`) GREEN — REGRESSION,
  GOVERNANCE, PROMOTING crítico (candidate real + operation RUNNING órfã, nunca duplica),
  POST_PROMOTION_VERIFY, tentativa abandonada explicitamente.
- commit: `f3d1e006`.
- status: **GREEN**

### ER-V1-SEALFIX-002 — Real Container Deployment

- RED confirmado com Docker real (não hipotético): `ROOT` calculado via `path.resolve(__dirname,
  ...)` em `executionSandbox.js`/`contextBuilderService.js` resolve um caminho relativo à imagem
  do container — mas o runner monta volumes via `docker run -v` executado pelo Docker daemon do
  HOST (socket), que resolve caminhos contra o filesystem do HOST, nunca do container que emitiu
  o comando. Confirmado rodando o runner real em container isolado: sem a correção, os mounts
  do sandbox apontariam para caminhos inexistentes no host.
- fix: `ENGINEERING_ROUTER_HOST_REPO_ROOT` (nova env var) tem precedência sobre `__dirname` nos
  dois módulos; `docker-compose.yml`/`docker-compose.prod.yml` ganham bind mounts idênticos
  (nunca volume nomeado) nos serviços `api` e `engineering-runner`. Achado adicional só visível
  em container real: Dockerfile do runner não copiava `commandPolicy.js`/`constants.js`/
  `safeEngineeringEnvironment.js` (dependências do SEALFIX-003) — corrigido.
- tests: E2E real com Docker de verdade (build + 2 containers separados, rede isolada, sem porta
  publicada) — 4/4 GREEN (workspace do host montado corretamente pelo daemon, código fora do
  workspace não exposto, fronteiras de rede/cwd do SEALFIX-003 ativas dentro do container real).
  Validado também manualmente ao vivo antes de automatizar.
- commit: `08d9f362`.
- status: **GREEN**

**Todos os 4 blockers ER-V1-SEALFIX-001..004: GREEN. `ENGINEERING_ROUTER_V1_SEALED = true`**
(seal-certification.json, recomputado independentemente pelo verifier).

## SELAR O ENGINEERING ROUTER — decisão final

HEAD final desta fase: `08d9f3622832c427a895d77b8ec3ddd138b10b59`.

- Structural: PASS, 209 checks, 0 falhas.
- Runtime: RUNTIME_PASS, 25/25, 0 falhas.
- Regressão completa do Router (serial): 51/51 suítes, 364/364 testes.
- `npm run test:unit` (projeto inteiro): 852/853 suítes, 6549/6551 testes.
- Audit envelope gerado + verificado offline contra um ZIP de release real: PASS, 160 checks,
  0 falhas (binding completo código↔fingerprint, sem `.git`/DB/rede).
- Ver `ENGINEERING_ROUTER_V1_SEAL_REPORT.md`/`.json` (derivados da evidência real, não escritos
  manualmente).

```
ENGINEERING_ROUTER_V1_SEALED = true
```

A partir daqui: NENHUMA nova melhoria no Engineering Router nesta missão. Qualquer achado não
bloqueante vai para `POST_RELEASE_MODEL_ROUTER_BACKLOG.md`. A missão prossegue para a FASE RAP
GLOBAL (source freeze final + novo governed run + QA Mesh same-run + gates obrigatórios).

## FASE RAP GLOBAL — Source Freeze final

```
FINAL_SOURCE_HEAD=0a69bdaed04d41979a5550464c7738a35db6cecc
FINAL_SOURCE_TREE=080bc2ac3de9e4c5c8c3e1034120847e8d82c103
FINAL_SOURCE_FINGERPRINT=04280aa266c022750969878ab02675211f7fa97fd759a8e55b06399d2d1b0344
```

Working tree limpo neste HEAD (`git status --porcelain` vazio) — nenhuma alteração de source
desde a selagem do Router acima.

## Novo governed run

```
RUN_ID=rap-governed-20260923164847089-171c2c08
SOURCE_FINGERPRINT=04280aa266c022750969878ab02675211f7fa97fd759a8e55b06399d2d1b0344 (idêntico ao freeze acima)
POLICY=RAP-AGENT-CONSTITUTION v1.0.4, policyFingerprint=4105767b265223362456fabfab89eef312e12d777e55af409f5eb9b1bb8548fb, status=PASS
CRIADO_EM=2026-09-23T16:48:47.195Z
```

Nunca reaproveita QA/Final Consistency/Final Readiness/runtime evidence/release report de runs
anteriores — tudo o que segue nasce DENTRO deste run.

---

# RETOMADA DA MISSÃO — segunda passagem (2026-09-23T19:1x UTC)

## BASELINE 2

```
HEAD=0a69bdaed04d41979a5550464c7738a35db6cecc
SOURCE_FINGERPRINT=04280aa266c022750969878ab02675211f7fa97fd759a8e55b06399d2d1b0344
STARTED_AT=2026-09-23T19:10:00Z
ROUTER_STRUCTURAL=PASS (209 checks, 0 falhas) — ENGINEERING_ROUTER_V1_SEALED=true
ROUTER_RUNTIME=RUNTIME_PASS (25/25, 0 falhas) — fingerprint 04280aa2 (mesma fonte)
QA_MESH=NO_GO (mesh-20260923164907-rjc1js; 135/144, failed=4, infra=1, flaky=4)
FINAL_CONSISTENCY=stale (run rap-governed-20260922083602035-87410cca)
FINAL_READINESS=stale (projeção dev/platform-readiness/latest.json com runId estrangeiro)
GOVERNANCE=stale
CURRENT_RUN_ID=rap-governed-20260923164847089-171c2c08 (stale — source regredido, ver abaixo)
```

## REGRESSION encontrada no worktree (corrigida antes de qualquer outra ação)

Dois arquivos de SOURCE estavam revertidos para um estado ~7 commits anterior, removendo
integração do Engineering Model Router do código entregue:

- `package.json` (blob `fccbb6db`, era o de `ERV1-CLOSE-010`): sem
  `collect:engineering-router-runtime-evidence`, sem `validate:engineering-router-v1:runtime`,
  sem `engineering-router:audit-envelope:generate|verify` e sem `verify:engineering-router-v1-envelope`;
  o gate agregado `validate:governance-enforcement` chamava `validate:engineering-router-v1` no lugar
  de `validate:engineering-router-v1:runtime` — o gate de runtime do Router saía SILENCIOSAMENTE do
  agregado (falso GREEN permitido).
- `api/db/models/index.js` (blob `dc53bddb`, era o de `ER-V1-FINAL-006`): sem
  `EngineeringRegressionRun`, `EngineeringModelCatalogEntry` e `EngineeringOperation`
  (modelo criado por `ER-V1-SEAL-002`) e sem as associações `regressionRuns`.

Origem: escrita dos dois arquivos em `2026-09-23T19:14:30/49Z` (mtime), DEPOIS do fim do mesh das
17:54Z e sem entrada de checkout/reset no reflog. Nenhum script do repositório faz esse revert.

**Causa raiz confirmada** por evidência já versionada: `POST_RELEASE_MODEL_ROUTER_BACKLOG.md`
(seção "Integração futura") documenta exatamente este modo de falha — *"um
`two-pass-release.sh`/`seal-release.sh` rodando em paralelo pode restaurar o working tree principal
e afetar arquivos ainda não commitados"*. Um pipeline de release concorrente restaurou o worktree
para um snapshot anterior. É o mesmo defeito de integridade: um gate (runtime do Router) sai do
agregado silenciosamente e passa a permitir falso GREEN.

Ação: `git checkout HEAD -- package.json api/db/models/index.js`. O fingerprint de source voltou a
`04280aa2…`, idêntico ao fonte congelada do selo do Router — nenhuma outra divergência de source
(`git status` pós-restauração: apenas artefatos de relatório + este documento).

## Novo governed run (válido sobre a fonte restaurada)

```
RUN_ID=rap-governed-20260923191944590-02980291
SOURCE_FINGERPRINT=04280aa266c022750969878ab02675211f7fa97fd759a8e55b06399d2d1b0344
SOURCE_COMMIT=0a69bdaed04d41979a5550464c7738a35db6cecc
SOURCE_TREE=080bc2ac3de9e4c5c8c3e1034120847e8d82c103
POLICY=RAP-AGENT-CONSTITUTION v1.0.4 (attestation PASS)
CRIADO_EM=2026-09-23T19:19:44.822Z
```

## Achados reais do mesh anterior (mesh-20260923164907-rjc1js) e classificação

| item | domínio | status anterior | causa raiz | classificação |
|---|---|---|---|---|
| `business-core-biz-flows-editor` | core | PASS nesta execução (fail/flaky nas 3 anteriores) | `groq` sem credencial → 401 → circuit breaker aberto; fix `affb5708` faz a mensagem carregar "credencial não configurada" → mesh classifica `environment_missing` (não bloqueante) | externo/ambiente — revalidado PASS com o stack vivo |
| `fitness-matricula-{checkin,checkout,cancelamento,onboarding}` | fitness | failed | `page_error: Request timed out after 15000ms` — requisição do frontend PROD (timeout 15s) contra API saturada (login levou 47s) | ambiente/carga (POST_RELEASE_HARDENING) |
| `fitness-matricula-leads` | omnichannel | infra_error | idem acima (2 timeouts) | ambiente/carga |
| `fitness-matricula-agendamento-ui`, `support-inbox-nota-ui` | fitness/omnichannel | flaky (blocking) | `Tempo limite excedido aguardando execução RPA` | ambiente/carga |
| `business-core-biz-academy`, `business-core-biz-rag-segregation` | core | flaky | rag-service NÃO estava vivo (8001 ausente) + carga | ambiente — revalidado com rag-service vivo |

O pipeline anterior (`npm run pipeline`) rodou o mesh concorrendo com `test:unit` já reprovado e com
a GUI/workstation sob load average ~11,6 (12 cores) — a latência da API estourou o timeout de 15s do
bundle de produção nas páginas RPA.

`unit-tests` do pipeline anterior falhou (`exit 1`) em
`tests/unit/governance/convergenceFixpoint.test.js` → projeção `dev/platform-readiness/latest.json`
com runId ESTRANGEIRO em relação ao run corrente. É o defeito de sequência de convergência
(produtor de projeção tem de rodar depois da criação do run) — resolvido pela convergência canônica.

## Pré-requisitos REAIS de ambiente para a etapa 1/12 (enterprise proof smoke)

A convergência abortava em `1/12` com `enterprise-proof-report.ok=false` antes de qualquer
evidência de run. Diagnóstico medido (não hipótese), em 3 defeitos de ambiente DISTINTOS:

1. **L-04 (`scripts/test-pbx-call-events-runtime-smoke.js`)** insere o CDR sintético por
   `docker compose -f docker-compose.test.yml exec -T api …`. Nesta estação não existe serviço
   `api` nesse compose → `synthetic_cdr_insert_failed:1:service "api" is not running`.
   Modo suportado pelo próprio script:
   `PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct` + `PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK=1`
   (satisfaz `assertDirectModeDbIntent()`), mesma lógica e mesma DB, sem Docker.
2. **Ponte host↔container ausente**: `scripts/pbx-host-db-bridge.sh` (socat
   `172.17.0.1:15432` → `127.0.0.1:5432`). O container já tinha o DSN correto
   (`ODBCINI=/tmp/odbc.ini` → `r_agent2`, verificado lendo `/proc/1/environ`), mas sem a ponte
   o INSERT do Asterisk nunca chegava ao banco do host → `pbxProdLike.cdr=false`,
   `hangupCauses=false` e `omnichannelUnifiedReplay.pbx=false` (uma causa, três sinais).
3. **Contexto de tenant não declarado no Asterisk**: `/etc/asterisk` é `tmpfs` populado no
   start a partir de `/etc/asterisk-static`. O `conf/tenants.conf` gerado pelo
   `syncRealtimeTenantContexts` (host, 09-22T23:10Z) continha `debug-e2e-engineering-router`,
   mas o **tmpfs do container tinha a cópia de 09-12** — `dialplan reload` via AMI não relê o
   arquivo do host. Sem a declaração, `Local/9191@<tenant>` não tem dialplan → chamada não
   atendida → `Log unanswered calls: No` → nenhum CDR.
   Remedição correta: `docker restart chatbot-asterisk` (re-copia o tmpfs) + confirmar
   `asterisk -rx "dialplan show debug-e2e-engineering-router"` = `Realtime/…@extensions`.
   Após isso: CDR real gravado (`dst=9191, disposition=ANSWERED`) e
   `enterprise-proof-report.ok=true` com os 3 blocos `ok=true`.

Nenhum código-fonte foi alterado para isto — é reparo de ambiente da estação de dev. Registrado
como `POST_RELEASE_HARDENING` a fragilidade estrutural (tmpfs do Asterisk + reload que não
relê o arquivo do host; e o smoke L-03 escolher o tenant mais novo não-`system`).

## 4º defeito de runtime (causa raiz das falhas RPA `fitness-matricula-*`) — medido

Rodada `converge` #3 chegou a executar o mesh (etapa 8/12) e reprovou em
`fitness-matricula-agendamento-ui` (blocking) e `fitness-matricula-checkout` com
`Tempo limite excedido aguardando execução RPA` (10 min × 2 tentativas = 20 min por cenário).

Causa raiz provada, não hipótese:

```
GET /workspace   (Accept: text/html)   vite preview 5173  ->  404  len=0    {"error":"not_found"}
GET /workspace   (Accept: text/html)   vite dev     5174  ->  200  len=1135 (index.html)
GET /support, /tasks, /dev/qa-waves    (ambos)             ->  200
```

`frontend/vite.config.mjs` registra o plugin `frontend-routes` **somente** com
`configureServer` (DEV). No `vite preview` o plugin não existe, e o `bypass` da regra de proxy
`'^/workspace'` devolve `false` para navegação HTML — o Vite termina a resposta em vez de servir
o SPA, então `/workspace` cai no `x-api-route-fallback` da API (404 JSON).

Consequência: **todos** os seeds `fitness-matricula-*` (metadata `autoLogin`, pouso em
`/workspace`) travam até o timeout do adaptador. O runtime usado por `pipeline/runFullValidation.js`
em `ensureRuntime()` é `npm run preview` quando a 5173 está livre — armadilha silenciosa.

Prova de que não é defeito de produto: com o **dev server** na 5173, o mesmo seed executa
`18/18` passos com `success: true` (jornada real: workspace → Construtor → Execução → Tarefas →
criar tarefa → Agendar → modal → toast "Agendamento criado").

Ação: convergência reexecutada com `npm run dev:frontend` na 5173 (runtime correto). Defeito do
preview registrado como `POST_RELEASE_HARDENING` (fazer o preview servir as rotas SPA ou falhar
de forma explícita — nunca deixar o run rodar com runtime quebrado).

## 5º defeito (RELEASE_BLOCKER de integridade da prova) — corrigido em código

`scripts/check-dist-clean.sh` (raiz de fingerprint) rejeitava
`dist/engineering-router-v1-audit-envelope` como "arquivo inesperado na raiz de dist/" — MAS é
exatamente de lá que `scripts/generate-zip.sh` embarca o envelope em
`<pacote>/evidence/engineering-router-v1/`. Medido no candidato real
(`dist/release/r-agent2-20260923-181537`): o ZIP era selado CORRETO (com o envelope dentro) e o
gate bloqueava depois, com `CHECK-DIST-CLEAN: FAIL`.

Consequência: **nenhuma** release pelo pipeline oficial podia satisfazer o requisito de deliverable
self-proving (`código == fingerprint certificado`), porque a prova era removida/rejeitada antes do
pacote existir.

Fix: entrada explícita e justificada na allowlist de `dist/` (mesmo tratamento de `candidate/` e
`archive/`), com o racional de que o envelope é artefato GOVERNADO de release: produtor oficial,
content-addressed (`hashes.json`) e verificado offline contra o código entregue. Commit `eeb18e2f`.

## Fonte final congelada (após o fix)

```
HEAD_AGORA=0e42bfb8ba540ac7054936180a8931381f9dbed4 (commit do envelope)
FINAL_SOURCE_FINGERPRINT=89818f8e1b272fc1e1962d87f7cf670ff9bcb493b3b122f0185ab4f89cc90884
GOVERNED_RUN=rap-governed-20260923220508741-cd53886e
ROUTER_RUNTIME=RUNTIME_PASS (25/25, 0 falhas, recertificado nesta fonte)
ROUTER_STRUCTURAL=PASS (209 checks, 0 falhas)
AUDIT_ENVELOPE=head 0e42bfb8, fp 89818f8e, runtime RUNTIME_PASS, structural PASS, sealed true, decision GO
```

## CLEAN RELEASE #1 — `r-agent2-20260923-203701`

```
commit       dc6b7fdec16a8f6f3835a38718c0b7b283b9cb93
git_tree     a5b3abbf5f838786317f4a0f4e78c101342ab17c
sourceFingerprint 89818f8e1b272fc1e1962d87f7cf670ff9bcb493b3b122f0185ab4f89cc90884
runId        rap-governed-20260923220508741-cd53886e
H_final      65bd22309b2912ced04adb2ae11a5f8d335271684f180c49d3204ff7499c8dd5
delivery zip sha256 65bd22309b2912ced04adb2ae11a5f8d335271684f180c49d3204ff7499c8dd5
payload  zip sha256 91ded99da62275f30d27e8861232f9c1a81cffdca6c890fade50b25d669046cb
scorecard    78/78, below10=0, AUTONOMOUS_READY
gate agregado EXIT 0 | MCP_RESEARCH_DOCKER_E2E PASS fresco
verify:delivered-release DELIVERED_RELEASE_VERIFIED
publicação   8/8 PASS, recibo PUBLISHED_VERIFIED, tag remota conferida
```

### OFFLINE_VERIFY #1 — PASS

- Envelope do Router, executado **contra o ZIP real**, sem `.git`/DB/rede:
  `status=PASS checks=160 falhas=0` (binding `ACTUAL_PACKAGE_SOURCE_FINGERPRINT` ativo contra
  todos os artefatos com `sourceFingerprint`).
- Verificação rígida offline do payload (`dist/verifier/check-dist-clean.sh` →
  `verify-enterprise-governance-v2.sh` → `verify-payload-governance.js`, autocontido):
  `CHECK-DIST-CLEAN: PASS` (exit 0).
