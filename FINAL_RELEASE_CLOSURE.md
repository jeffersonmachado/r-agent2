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

## TERCEIRA PASSAGEM — 2 defeitos de ambiente REAIS + otimizações seguras de tempo

Contexto: o RELEASE #2 falhou 3× seguidas, e a terceira falha foi atribuída (hipótese inicial) a
"flakiness do provedor de IA" no mesh `mesh-2026-09-24T01-26-03-248Z` (141/144 →
`CRITICAL_DOMAIN_FAILED:core` + `BASELINE_PASS_RATE_REGRESSION`). A investigação mostrou que
**não era flakiness**: eram 2 defeitos de ambiente determinísticos.

### 6º defeito — `enabled=false` de provider builtin era um NO-OP (causa raiz das falhas `core`)

Diagnóstico em duas camadas, a segunda só apareceu porque a primeira foi refutada por medição.

1. **Sintoma**: `ai_providers.groq.enabled = t` sem nenhuma linha de `groq` em
   `tenant_ai_credentials` para o tenant `system` (existiam `openai`, `deepseek`, `kimi`, válidas).
   `CORE-BIZ-FLOWS-EDITOR` falhava em `flow-validation` com
   `500 Provider de IA 'groq' indisponível (circuit breaker aberto)`, arrastando
   `business-core-biz-academy` e `business-core-biz-rag-segregation`.
2. **Primeira tentativa (INÓCUA)**: `UPDATE ai_providers SET enabled=false WHERE key='groq'`
   fez os 3 cenários passarem 3/3 em isolamento — mas o efeito **não sobreviveu ao boot**: o
   valor voltou a `enabled = t` (com `updated_at` intacto, prova de que a escrita não veio de
   `now()`).
3. **Causa raiz (código)**: dois defeitos em `api/services/aiProviderRegistryService.js` +
   `api/services/aiProviderService.js`:
   - `ensureBuiltinProviders()` gravava `enabled: true` em **toda** sincronização de boot
     (`existing.update(data)`), reescrevendo a decisão do operador → o toggle de provider
     builtin era um no-op;
   - `getRuntimeProviders()` **hardcodava** `enabled: true` para todos os builtins e o loop do
     banco fazia `if (!row.enabled) continue` — então um builtin desabilitado continuava
     presente no map de runtime;
   - `initializeAiProviders()` registrava todo provider do map **sem** checar `enabled`, ou seja,
     mesmo o map corrigido ainda seria invocado.
4. **Correção (código, mesma fonte)**: o catálogo governa metadados; `enabled` é do operador.
   `ensureBuiltinProviders()` só nasce habilitado no INSERT; `getRuntimeProviders()` aplica o
   `enabled` real do banco ao builtin (default do catálogo apenas na ausência de linha);
   `initializeAiProviders()` **não registra** provider com `enabled === false` (fail-closed).
5. **Prova**: boot registra `✅ OpenAI/Anthropic/DeepSeek/Kimi/Mistral` e
   `⏭️ Provider Groq desabilitado — não registrado`; `ai_providers` mantém `groq=false` após o
   boot; os 3 cenários passam **3/3** com **zero** ocorrências de `circuit breaker aberto`.

> Correção importante de leitura: a narrativa inicial ("basta desabilitar o groq no banco") era
> **falsa** — o fix só valeu depois do conserto de código acima. Fica registrado para não se
> repetir o atalho.

### Saturação de pool observada no mesh — SINTOMA, não causa (medido)

O mesh `02:34` registrou 22 `SequelizeConnectionAcquireTimeoutError` (inclusive
`Project.count` → `500 Erro ao criar projeto`, único `failed` real do run). Investigado e
**deliberadamente NÃO "corrigido" por aumento de limite**:

- `DB_POOL_MAX=40` (em `.env`); PostgreSQL `max_connections=100`.
- Os **3 meshes 144/144** anteriores rodaram com **exatamente essa mesma configuração** e zero
  saturação — logo o pool não é o defeito;
- a saturação acompanha o **storm de IA**: cada chamada a um provider quebrado percorre a cadeia
  de fallback, relê credenciais/settings no banco e reencadeia retries — pressão de conexão +
  volume de 500s. Corrigida a causa raiz (acima), a pressão esperada é a dos meshes verdes.
- Fica como item de `POST_RELEASE_HARDENING` (abaixo), com o número medido, para o caso de a
  saturação reaparecer em mesh verde.

### 7º defeito — `nodemon` reinicia a API DENTRO do run e mata o cenário

- `nodemon.json` observa `api`, `engine`, `src`, `qa-mesh`; qualquer escrita nessas árvores durante
  QA/mesh provoca restart e o cenário morre com `fetch failed (cause: UND_ERR_SOCKET)`.
  Medido: `CORE-BIZ-FLOWS-EDITOR` falhou exatamente assim (`flow-validation`, 42 s) enquanto a API
  reiniciava.
- Correção (ambiente): rodar a API **sem supervisor** no ciclo de governança
  (`node --env-file-if-exists=.env api/server.js`), e o preflight agora avisa quando há nodemon.

### Otimizações seguras de tempo implementadas (nenhum gate enfraquecido)

Fonte única de custo medida: mesh 28–30 min quando verde contra 65–75 min quando um seed RPA trava
(10 min de deadline × 2 tentativas = 20 min por cenário travado).

1. **Fail-fast por estagnação em `qa-mesh/adapters/rpaAdapter.js`**: uma execução viva que para de
   progredir (`progress`/`currentStep`/`totalSteps` inalterados por `QA_MESH_RPA_STAGNATION_MS`,
   default 3 min) termina imediatamente com
   `metrics.status='stagnation'` + `errors[0].error='rpa_execution_stagnation'`.
   Justificativa medida: **nenhum passo dos seeds declara timeout > 20 s** e o auto-login não emite
   progresso por ~45–60 s, logo "sem mudança por 3 min" só ocorre em travamento real.
   O cenário continua **FALHANDO** (nunca é mascarado) e **mantém o retry** — muda apenas o tempo
   de detecção, com motivo explícito na evidência.
2. **Preflight de ambiente (etapa 0) em `scripts/governance/converge-governance.sh`**: valida em
   segundos o que antes só era descoberto depois de 30–50 min de ciclo — API 3001, `/workspace`
   servido pelo frontend na 5173 (reprova `vite preview`, defeito #4), rag-service 8001 (reprova
   cedo a causa do NO_GO 8.5/12), `PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct`, ponte
   host↔Asterisk em 15432, `tenants.conf` em vigor no tmpfs do Asterisk (compara mtime container
   × host), sobras de `dist/` de ciclo anterior (defeito do `package-validator`), e avisa se a API
   está sob `nodemon`. Falha com mensagem acionável, não com stack trace.

### Estado do RELEASE #2

Bloqueado por `qa-mesh=NO_GO` (causa raiz = defeito 6). Após a correção do provedor, os 3 cenários
críticos passam isoladamente; o ciclo de governança precisa ser re-executado sobre nova fonte
congelada (as otimizações acima vivem em raízes de fingerprint).

## OTIMIZAÇÕES DE TEMPO IMPLEMENTADAS (com prova medida)

Quatro defeitos que custavam ciclos inteiros foram corrigidos e **provados** nesta missão.

### 8º defeito — `ENGINE_AI_TIMEOUT_MS` de 30 s contra modelos que levam 26 s (CAUSA RAIZ DO FLAKY)

O mesh do run `rap-governed-20260924034627968-75141ffd` terminou com **0 falhas e 3 flaky**
(`business-core-biz-academy`, `-flows-editor`, `-rag-segregation`) → `CRITICAL_DOMAIN_FAILED:core`
→ `NO_GO`. O domínio crítico trata flaky como falha, então o release ficou bloqueado.

- A causa não era "rede instável": o log da API mostrou
  `ai_timeout: provider de IA excedeu 30000ms` em `openai` — ou seja, **o NOSSO** timeout
  abortando uma chamada real.
- Medição com geração representativa (mesmos modelos configurados do tenant `system`):

  | Provider | Modelo | Latência medida | tokens de saída | % do orçamento de 30 s |
  |---|---|---|---|---|
  | openai | `gpt-5.2` | 12,8 s / 15,5 s | 1302 / 1561 | 52% |
  | deepseek | `deepseek-flash` | 4,9 s / 5,3 s | 900 | 18% |
  | kimi | `kimi-k2.6` | **22,4 s / 25,8 s** | 900 / 1200 | **86%** |

  Com o kimi consumindo 86% do orçamento, qualquer variação de carga estoura o timeout, a
  cadeia cai para o próximo provider e o cenário termina `flaky`.
- Correção: `ENGINE_AI_TIMEOUT_MS=90000` (3,5× a pior medição real). Chamada que passa de 90 s
  está **travada**, não lenta — o fallback continua funcionando.
- Nota de método: isto **não** é "aumentar timeout para ficar verde" — é dimensionar o timeout
  contra o tempo real dos modelos configurados, com o número medido ao lado.
- Prova: **3 rodadas × 3 cenários = 9/9 PASS com zero `ai_timeout`** (antes: falha em 100% dos
  runs recentes). `.env` é gitignored, então a correção **não exige novo freeze** nem
  recertificação do Router — o run governado permanece válido.

### 9º defeito — `RUN_SOURCE_DRIFT` descoberto DEPOIS do mesh (queimava ~30 min)

Reproduzido duas vezes: a convergência só descobria o drift depois do passo 8, e o selador então
criava outro run e **re-executava o mesh inteiro**. Correção: `drift_guard()` em
`converge-governance.sh`, chamado logo após o preflight e **imediatamente antes do mesh**, com o
mesmo marcador `RUN_SOURCE_DRIFT` que o selador já reconhece (a recuperação automática continua
valendo, só que sem perder o mesh).
Prova real: o guard detectou o próprio commit pendente desta missão
(`source 5e815da5… != run 1ae8a61e…`) e saiu 1 com mensagem acionável.

### 10º defeito — sobras em `dist/` derrubavam o empacotamento (2 ciclos perdidos)

`artifact_manifest_invalid: … Unexpected token 'P', "PK"` porque o `package-validator` recebeu o
ZIP do ciclo anterior. O preflight agora também barra sobras em `dist/release/*` e
`dist/candidate/*`, além do `dist/r-agent2-*.zip` que já cobria.

### 11º defeito — `vite preview` sem as rotas SPA (runtime quebrado em silêncio, ~20 min)

O middleware `frontend-routes` só era registrado em `configureServer` (DEV).
`pipeline/runFullValidation.js::ensureRuntime()` sobe `npm run preview` quando a 5173 está livre
→ `/workspace` respondia **404 com 0 bytes** e todos os seeds `fitness-matricula-*` travavam
(10 min × 2 tentativas), com o pipeline reportando runtime OK.
Correção: o middleware passou a ser registrado também em `configurePreviewServer`.
Prova: `vite preview` na 5199 → `/workspace` **200 com 1111 bytes** (antes 404/0), e
`/support`, `/editor`, `/dev/qa-waves`, `/login` todos 200.
`frontend/vite.config.mjs` **não entra no source fingerprint** (verificado por probe), então
também não exigiu freeze.

### Pendentes por governança (NÃO implementados, com o motivo)

- **Reuso de sessão autenticada nos seeds RPA (~4–5 min/ciclo)**: tecnicamente viável (o
  auto-login é helper pré-passo, `core/rpa/utils/autoLoginFlow.js`), mas altera o estado inicial
  das execuções e toca replay governance (`replayHash`/tamper detection) — exige decisão e
  regressão RPA completa.
- **Concorrência entre grupos do mesh (~14–18 min/ciclo)**: medido overlap **0,99** (26 grupos
  somando 27,7 min de 28,0 de wall). É a maior alavanca, mas o mesh produz evidência canônica
  same-run (RAP-024/026) e a serialização existe para não introduzir contenção — mudança
  governada, não patch sob pressão de release.
- **Break de circuito contaminado por erro de configuração**: `wrapProviderGenerate` chama
  `breaker.recordFailure()` para **todo** erro, inclusive `ai_provider_not_configured`
  (credencial ausente não é indisponibilidade do provider). Correção identificada, não aplicada
  (exigiria novo freeze sem necessidade para este ciclo).

## SEGUNDA RELEASE — DESFECHO HONESTO (NO_GO) e causas medidas

Tentativas de produzir a segunda clean release nesta sessão: 5 ciclos completos de `release:seal`.
Nenhum chegou à fase `candidate`. Motivo imediato, idêntico nos ciclos finais:

```
[converge] 3/12 qa-waves enterprise governance (bridge)
=> status NO_GO | operationalConfidence 79.2 | confidenceGrade D | riskLevel CRITICAL
   reasons: qa_waves_status_not_go, qa_waves_replay_integrity_invalid,
            qa_waves_governance_signature_invalid, qa_waves_active_blockers,
            qa_waves_continuous_smoke_degraded, qa_waves_operational_confidence_degraded,
            qa_waves_enterprise_signing_key_unavailable
```

O bridge exige `governanceStatus: GO`, `replayIntegrity.valid`, `governanceSignature.valid`,
`continuousValidationStatus.healthy` e confiança **≥ 95** (medido: **79,2**). Sem isso a
convergência aborta em 3/12 e **nenhum selo novo pode existir** — a governança canônica está
`NO_GO` e a regra da missão proíbe declarar release verde.

### Por que o estado degradou (tudo medido)

1. **`qa_waves_continuous_smoke_degraded`** — o smoke contínuo de produção tem TTL de 48 h e a
   última evidência `END status=GO` é de **2026-09-22T07:24Z** (vencendo exatamente às
   **07:24Z de 24/09**, momento em que os ciclos passaram a falhar em 3/12).
2. **O cron que deveria renovar essa evidência derruba o próprio runtime**:
   `crontab`: `23 4 * * * … run-scheduled-production-health-smoke.sh` (04:23 local). O script
   chama `stop_dev_services()` — `pkill -f "node api/server.js"`, `pkill -f "vite --configLoader"`,
   `pkill -f "uvicorn main:app"` — e **só depois** verifica `reachable(API_URL)`; como ele mesmo
   acabou de matar a API, o resultado é sempre `SKIP api=… indisponível`. Reproduzido no log
   `logs/qa/scheduled-production-health-smoke.log` em 24/09 07:23:02Z e em 23/09 07:23:01Z (além de
   19/09, 20/09 ×2, 21/09, 22/09). Ou seja: **a evidência expira e o renovador não consegue renová-la**
   no ambiente de dev — ele só produz GO quando a stack prod-like Docker está no ar em 3001/8080.
3. **Impacto direto nos ciclos**: em 24/09 07:23:02Z o cron matou a API, o Vite dev server
   (exit 143) e o rag-service **durante** um `release:seal` em andamento → o preflight do ciclo
   seguinte reprovou com `✗ frontend … devolveu 000`, e ciclos anteriores perderam cenários por
   runtime morto no meio do mesh. O cron foi temporariamente desabilitado (backup
   `/tmp/crontab-backup-20260924-042504.txt`) e **restaurado ao final**.

### Classificação dos achados desta sessão (taxonomia da missão)

| Achado | Classificação | Evidência |
|---|---|---|
| `enabled` de provider builtin era no-op (groq sem credencial roteado) | **RELEASE_BLOCKER** (corrigido) | commit `31e0596d`; boot registra "Groq desabilitado"; 3/3 cenários |
| `ENGINE_AI_TIMEOUT_MS` 30 s vs modelos de 22–26 s (`ai_timeout`) | **RELEASE_BLOCKER** (corrigido) | 9/9 PASS sem `ai_timeout`; kimi 25,8 s medidos |
| 90 s colidia com o teto de 90 s do cliente | **REGRESSION** (introduzida e corrigida por mim) | seed `fitness-matricula-leads` `Request timed out after 90000ms` → `completed` com 45 s |
| `RUN_SOURCE_DRIFT` descoberto **depois** do mesh (queimava ~30 min) | **RELEASE_BLOCKER** de eficiência (corrigido) | `drift_guard()` provado detectando commit pendente |
| sobras de `dist/` derrubavam o empacotamento (2 ciclos perdidos) | **RELEASE_BLOCKER** (corrigido) | `artifact_manifest_invalid: "PK"` |
| `vite preview` sem rotas SPA (runtime quebrado em silêncio) | **RELEASE_BLOCKER** (corrigido) | `/workspace` 404/0 → **200/1111** |
| Cron de smoke derruba API/Vite/RAG e não renova evidência | **RELEASE_BLOCKER (ambiente, ABERTO)** | log do smoke 24/09 07:23:02Z |
| Evidência de smoke contínuo expirada (TTL 48 h) | **RELEASE_BLOCKER (governança, ABERTO)** | último GO 22/09 07:24Z; ciclo 3/12 NO_GO |
| `PropertyField.jsx:510` chama IA sem `timeoutMs` (default 15 s em produção) | **POST_RELEASE_HARDENING** (patch pronto) | latências medidas 4,9–25,8 s |

## Decisão final

**`NO_GO` para a segunda release.** A governança canônica está `NO_GO`
(`final-readiness = NO_GO:MANDATORY_GATE_BLOCKED [qa-mesh=NO_GO | release-gate=NO_GO |
governance=NO_GO:GOVERNANCE_BLOCKED (scorecard: 34 blockers / 35 gaps abertos)]`, coverage gate
`NO_GO`), e nenhum selo novo é produzível enquanto o bridge de QA Waves reprovar em 3/12.

**O que está entregue e verificado por bytes**:

- **Clean Release #1 `r-agent2-20260923-203701`** — selada, publicada e verificada offline:
  envelope do Router `status=PASS checks=160 falhas=0` contra o `payload.zip` real; commit
  `dc6b7fde…`, tree `a5b3abbf…`, delivery SHA256 `65bd2230…`, payload SHA256 `91ded99d…`,
  scorecard 78/78 com `below10=0`.
- **Reprodutibilidade**: o empacotamento anterior do MESMO freeze
  (`r-agent2-20260923-195042`) também verifica offline (`PASS checks=160`); os dois manifestos
  compartilham o mesmo `sourceFingerprint` e os payloads diferem **apenas em campos voláteis**
  (nome do release/timestamps) — exatamente o critério documentado.
- **Engineering Model Router V1**: `ER-V1-SEALFIX-001..004 = PASS`,
  `STRUCTURAL_PASS` + `RUNTIME_PASS` (209/0 e 25/0), envelope
  `ENGINEERING_ROUTER_V1_10_OF_10_GREEN` na fonte `5e815da5`.
- **Otimizações de tempo implementadas e provadas**: drift guard (~30 min/ocorrência), preflight
  de sobras (~10–20 min/ciclo), `vite preview` com rotas SPA (~20 min), fail-fast de estagnação
  RPA (20 min → ~5 min por seed travado), `ENGINE_AI_TIMEOUT_MS=45000` e breaker
  `threshold=6/reset=10s` (0 `ai_timeout`, 0 circuit-breaker aberto nos testes após o ajuste).

### Caminho exato para GO (próximo ciclo)

1. Subir a stack prod-like (Docker Compose) em 3001/8080 e rodar
   `scripts/smoke/run-scheduled-production-health-smoke.sh` para produzir evidência
   `production_health` fresca (renova `continuousValidationStatus`).
   Alternativa estrutural: corrigir a ordem do script (verificar `reachable` **antes** de
   `stop_dev_services`) e/ou suportar execução dev para a evidência.
2. Regenerar o relatório de QA Waves assinado com a chave enterprise disponível
   (`qa_waves_enterprise_signing_key_unavailable` hoje) para elevar
   `operationalConfidence` de 79,2 a ≥ 95.
3. Rodar `npm run release:seal` (a fonte `5e815da5` já está pronta: Router recertificado,
   preflight/drift guard ativos, runtime documentado) e então `OFFLINE_VERIFY #2`.

## POST_RELEASE_HARDENING (registrado, NÃO implementado nesta missão)

1. **`vite preview` não serve rotas SPA** — `frontend/vite.config.mjs` registra o plugin
   `frontend-routes` apenas em `configureServer` (DEV) e o `bypass` do proxy `^/workspace`
   termina a resposta. `pipeline/runFullValidation.js:ensureRuntime()` sobe `npm run preview`
   quando a 5173 está livre → o run roda com runtime quebrado **em silêncio**.
   Endurecer: `configurePreviewServer` com a mesma classificação de rotas, ou falhar explícito.
2. **Asterisk: `tenants.conf` é copiado para tmpfs só no start** e `dialplan reload` via AMI não
   relê o arquivo do host → contexto de tenant novo nunca entra em vigor sem restart do
   container. Endurecer: montar `conf/` diretamente (ou re-render no reload).
3. **Smoke L-03 escolhe o tenant mais NOVO não-`system`** (`/super-admin/tenants`) → qualquer
   tenant de debug criado por teste E2E vira o alvo da prova de PBX. Endurecer: tenant explícito
   obrigatório (`TEST_PBX_TENANT_ID`) ou excluir tenants de debug por contrato.
4. **Smoke L-04 depende de `docker compose -f docker-compose.test.yml exec api`** — serviço que
   não existe na estação de dev; sem `PBX_CALL_EVENTS_RUNTIME_INSERT_MODE=direct` a etapa 1/12
   da convergência aborta.
5. **Variáveis de runtime obrigatórias não são validadas no início do ciclo** (`PBX_*`,
   `TEST_FRONTEND_URL`, rag-service vivo em 8001): a convergência falha tarde (etapa 1/12 ou
   8.5/12) em vez de fail-fast. ~~Endurecer: preflight explícito em `converge-governance.sh`.~~
   **IMPLEMENTADO nesta missão** (etapa 0 de `converge-governance.sh`, ver seção acima).
6. **O pipeline de empacotamento não é re-executável sobre sobras do `dist/`**: um segundo ciclo
   consecutivo encontrou ZIP/manifest do ciclo anterior no root de `dist/` e o
   `package-validator` foi invocado com o nome do ciclo antigo
   (`artifact_manifest_invalid: .../r-agent2-20260923-213255.zip: Unexpected token 'P', "PK"...`).
   Nesta missão o ciclo só passou após limpeza manual do estado transitório
   (`dist/r-agent2-*.zip`, `dist/*.manifest.json`, `dist/candidate/*`, `dist/governance-artifacts/`)
   **preservando** `dist/archive/` e o envelope do Router. Endurecer: `zip:release` deve limpar
   o estado transitório por contrato (fail-closed se houver ZIP de ciclo anterior sem
   `published`/`archived` correspondente).
7. **Pipeline de release concorrente pode restaurar o worktree principal** (já registrado em
   `POST_RELEASE_MODEL_ROUTER_BACKLOG.md`) — **reproduzido nesta missão**: dois arquivos de source
   foram revertidos para um estado ~7 commits anterior, removendo a integração do Router do
   agregado. Ver "REGRESSION encontrada no worktree" acima.
8. **Qualquer arquivo sob raízes de fingerprint `scripts/**` (`*.js|*.cjs|*.sh`), `api/`,
   `governance/proof-engine/`, `qa/contracts` invalida o governed run em curso**
   (`RUN_SOURCE_DRIFT`) — inclusive um arquivo NOVO de ferramenta de apoio. Medido nesta missão.
   Endurecer: preflight avisando ao criar/editar arquivos sob essas raízes com run ativo.
9. **`reports/rag-domain-segregation-report.json` depende do rag-service vivo em 8001**; com o
   serviço fora, o coverage gate reprova honestamente (`rag_runtime_unreachable`) e a
   convergência aborta em 8.5/12. O gerador já carrega o `.env` sozinho (guarda
   `gateChildProcessEnv.test.js`), o que falta é o serviço no ar.
10. **Roteamento de IA não é consciente da credencial do tenant** (causa raiz de fundo do defeito
    6): o router pode escolher um provider habilitado para o qual o tenant não tem linha em
    `tenant_ai_credentials`. `enabled` no catálogo é uma condição NECESSÁRIA, não suficiente —
    a seleção deve exigir credencial utilizável do tenant antes de tentar o provider, e o estado
    "sem credencial" deve ser terminal (`provider_not_configured`), nunca `circuit breaker
    aberto` depois de N tentativas reais. Não implementado nesta missão: exige mudar o
    `modelSelector`/`engineeringModelAvailabilityService` (determinismo de replay).
11. **Saturação de pool sob mesh** (medida: 22 `SequelizeConnectionAcquireTimeoutError` no mesh
    `02:34`; pico observado de 43 sessões do banco durante UM grupo de 84 cenários;
    `DB_POOL_MAX=40`, `max_connections=100`). Tratada como sintoma do storm de IA (ver acima),
    **não** como limite a aumentar. Se reaparecer em mesh sem falha de IA: medir o pico de
    `pg_stat_activity` durante o mesh completo antes de mexer em `DB_POOL_MAX` — e observar que
    os processos de teste também abrem conexão própria, então o teto relevante é a soma
    (pool da API + pools dos processos de teste) contra `max_connections`.
12. **A convergência pode invalidar o próprio fingerprint do run** (`RUN_SOURCE_DRIFT` após as
    etapas 1-7): o selador já trata de forma reativa (cria novo run e re-executa o converge),
    mas isso queima o mesh de uma tentativa inteira (~30 min). Endurecer: cada etapa que escreve
    no repositório deve gravar em diretório fora das raízes de fingerprint, ou o fingerprint
    deve ser reavaliado ANTES do passo 8 (mesh) e não depois.
