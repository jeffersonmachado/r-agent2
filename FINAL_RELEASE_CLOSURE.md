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
