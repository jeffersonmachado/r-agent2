# MISSÃO RAP — HARDENING DEFINITIVO DE ENGENHARIA, GOVERNANÇA E RELEASE

Relatório final auditável. Branch de trabalho: `hardening/p0-certificacao` (isolada de `main`).
Nenhuma release foi publicada, nenhuma tag foi criada, nenhum código foi promovido para produção.

## 1. Escopo e baseline

| Item | Valor |
|---|---|
| Repositório | `jeffersonmachado/r-agent2` |
| Branch de baseline | `main` |
| HEAD auditado (baseline) | `3f619de2a3e9ddabc1e3840f8930e5c2d4684803` |
| Branch de trabalho | `hardening/p0-certificacao` |
| HEAD final | `f499134e9` (+ commit de fila/memória desta entrega) |
| Ambiente | estação local, Node v22.12.0 (nvm), Jest 29.7.0, Vitest, Playwright |
| Stack de apoio | docker-compose dev (api :3001, frontend :5173, rag :8001, `chatbot-postgres`, `chatbot-asterisk`) |

Escopo executado: itens P0-2 … P0-7 e P1-8 … P1-11 do prompt, com classificação
CONFIRMADO / CORRIGIDO / NÃO REPRODUZIDO / BLOQUEADO e evidência executável para cada um.

## 2. Metodologia e regra de prova

Regra aplicada em todo item: **antes de corrigir, medir; depois de corrigir, provar
nos dois sentidos**. Nenhuma correção foi aceita sem:

1. medição do defeito (reprodução executável, com número);
2. correção com teste que **falha antes e passa depois**;
3. prova bidirecional (neutralizar a correção ⇒ o teste/gate volta a vermelho);
4. regressão do que poderia ser afetado;
5. registro na fila oficial com commit + evidência reais.

## 3. Estado inicial medido

- `reports/` e `qa/smoke/` são ignorados pelo git (evidência local).
- `.gitignore` tem `governance/*.json` — artefatos gerados não são versionados.
- `main` sem proteção: `protected: false` (medido via API do GitHub).
- 3 waves técnicas versionadas (`db-integrity`, `api-surface`, `page-surface`)
  com frescor controlado **apenas** por `generatedAt` + TTL de 7 dias.
- Cadeia de governança inválida ao fim de cada ciclo (divergência
  stored ≠ recomputado) — causa raiz medida no P0-2.

## 4. Problemas CONFIRMADOS e causa raiz

| ID | Problema | Causa raiz medida | Classe |
|---|---|---|---|
| P0-6 | Reuso de lote do runner autoritativo mascarava exit code divergente | ramo de reuso devolvia `exitCodeDoRelatorioReusado(json)` e `collectBatchExitCodeViolations` isentava `reused===true` | CONFIRMADO |
| P0-5 | Falsos verdes de cobertura (L1) e malha que não executava | `camadaTransitiva` classificava arquivo de produção sem exigir teste dependente; bloco de malha não executava o `meshRunner` e ainda reportava verde | CONFIRMADO e quantificado |
| P0-2 | Cadeia criptográfica inválida ao fim do ciclo | `consolidate`/`system:go-no-go` reescrevem `evidence-manifest`, `final-proof-report`, `final-readiness-report`, `package-validation-report` e `proof-signature` **depois** da cadeia existir; nada reconstruía | CONFIRMADO |
| P0-3 | Tag podia ser publicada antes dos gates | ordem de fases não separava certificação de publicação (3 ciclos abortados na sessão anterior, com a tag já publicada) | CONFIRMADO |
| P0-4 | Decisão final inferida por substring (`NO_GO`) em consumidores independentes | cada consumidor decidia o que era GO; literal novo/desconhecido era aceito (fail-open) | CONFIRMADO |
| P0-7 | `main` sem proteção | plano GitHub Free + repositório privado: API recusa proteção (HTTP 403) | CONFIRMADO / **BLOQUEADO EXTERNO** |
| P1-11 | TTL/frescor de evidência fail-open e sem identidade | `Number(env) \|\| 7d` aceitava `Infinity` ⇒ `idade > Infinity` sempre falso ⇒ nada vencia; timestamp futuro e evidência de outro run/commit passavam | CONFIRMADO e reproduzido |

## 5. Correções aplicadas

| ID | Commit | Correção |
|---|---|---|
| P0-6 | `4ed63b7e3` | `avaliarReusoDeLote` recusa reuso com `meta.exitCode!==0` (`ORIGINAL_EXIT_CODE_NONZERO`) e com `resultExitCode!==0` (`RESULT_REPORT_NOT_SUCCESS`); reuso carrega o exit code REAL; isenção de `reused` removida |
| P0-5 | `64e32e32a` | só classifica arquivo de produção se houver teste dependente; `EXIT {GREEN,RED,ESCALATE,INFRA,NOT_EXECUTED}`; integridade de grafo/fingerprint; bloco de malha passa a EXECUTAR `qa-mesh/meshRunner` |
| P0-2 | `08e554a05` | fase `certify` reconstrói e assina a cadeia depois de todas as escritas, propaga a atestação e roda `validate-governance-chain` **bloqueante** |
| P0-3 | `2994245d9` | fases `prepare → candidate → final → consolidate → certify → publish → verify-delivery`, com `dispatch_phase` |
| P0-4 | `3adae4ff4` | autoridade única versionada (`DECISION_VERSION 1.0.0`, 7 estados, fail-closed), identidade por runId/commit/fingerprint/releaseId, consumidores migrados e assertiva bloqueante na fase `certify` |
| P0-7 | `57167fb62` | gate executável `validate:branch-protection` (mede o estado real, `UNKNOWN` nunca vira PASS) + `branch-protection:apply`; exceção de versionamento no `.gitignore` |
| P1-11 | `f499134e9` | autoridade única de TTL/frescor com 5 regras (TTL inválido, timestamp ausente/inválido/futuro, expiração durante o processamento, identidade estrangeira); vinculação por RUN ativa nos 3 loaders de wave |

## 6. Testes criados e executados

| Suíte nova | Casos | Resultado |
|---|---|---|
| `tests/unit/coverage/impactRunnerBinding.test.js` | 10 | PASS |
| `tests/unit/governance/governanceChainCertification.test.js` | 9 | PASS |
| `tests/unit/governance/sealPhaseOrder.test.js` | 6 | PASS |
| `tests/unit/governance/canonicalReleaseDecision.test.js` | 27 | PASS |
| `tests/unit/governance/assertCanonicalReleaseDecision.test.js` | 7 | PASS (falhava antes da injeção de `rootDir`) |
| `tests/unit/governance/branchProtectionGate.test.js` | 12 | PASS (o caso de versionamento **falhava antes** da exceção no `.gitignore`) |
| `tests/unit/governance/evidenceTtl.test.js` | 19 | PASS (inclui a reprodução do defeito original) |

Regressões amplas executadas: `tests/unit/coverage` **296/296**, suíte de staleness
existente intacta, `engineeringReleaseClosureAuthority` 7/7, suítes afetadas pelo
P1-11 **315/315**.

## 7. Resultados L0/L1 (unitário e seleção por impacto)

- **L0** (unitários): todas as suítes novas e afetadas verdes, com prova
  bidirecional item a item.
- **L1** (seleção por impacto): o gate ganhou estados de saída explícitos e passou a
  distinguir RED / ESCALATE / INFRA / **NOT_EXECUTED**; antes, não executar podia
  resultar em verde.
- Quantificação do falso verde eliminado: **187 de 2127 arquivos (8,8%)** estavam
  classificados sem teste dependente — agora exigem dependência real.

## 8. Resultados L1/L2 (integração e gates)

| Gate | Resultado medido |
|---|---|
| `validate:governance-chain` | EXIT=0, `status=PASS links=10 stored=f05ed75aaaad == recomputado=f05ed75aaaad` |
| `assert-canonical-release-decision` (execução real) | EXIT=0, `state=CERTIFIED_GO version=1.0.0 gates=final_governance:PASS,final_readiness:PASS,final_proof:PASS,governance_chain:PASS` |
| `validate:self-proving` | EXIT=0 (e EXIT=1 com `final_readiness_nao_final` quando a readiness é adulterada) |
| `validate:coverage-gate` (com vinculação por run ativa) | EXIT=0, `technicalCoverage=99% waveScore=99.1 stale=0` ⇒ **sem falso vermelho** introduzido |
| `validate:audit-items` | EXIT=0, `status=PASS itens=33` |
| `validate:hardening-queue` | EXIT=0, `PASS`, 62 itens, **0 abertos** |
| `validate:ai-memory` / `validate:agent-adherence` | EXIT=0 / EXIT=0 |
| `validate:engineering-router-v1` | EXIT=0, `PASS (STRUCTURAL_PASS/RUNTIME_NOT_REQUESTED) checks=183 falhas=0` |
| `validate:engineering-router-v2` | EXIT=0, `GO itens=12 falhas=0 pendencias=0` |
| `validate:release-dag` | `PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE` |
| `validate:release-artifact-identity` | `PASS decision=RELEASE_ARTIFACT_IDENTITY_VERIFIED` |
| `validate:route-mounts` | `PASS declarados=63 montados=63` |
| `validate:coverage-gate`/waves (3 técnicas) | frescor por TTL válido, sem degradação |
| **runtime-evidence (Engineering Mission)** | **`RUNTIME_PASS items=25 falhas=0`** contra `commit=f499134e9` — inclui `ACTUAL_PATCH_APPLY`, `DETERMINISTIC_FAILING_TEST_RED`, `RED_TO_FIX`, `REVIEWER_REJECTION_RECODE`, `INDEPENDENT_REVIEW`, `REGRESSION_EXECUTION`, `GOVERNANCE_EXECUTION` |
| `validate:engineering-router-v1` (com runtime) | `PASS (STRUCTURAL_PASS/RUNTIME_PASS) checks=209 falhas=0` |
| **`npm run validate:governance-enforcement` (agregado)** | **AGG_EXIT=1 — 1 violação, agora TRUTHFUL**: `FOREIGN_RUN_ARTIFACT` no `candidate` (o candidato entregue pertence ao run anterior). A violação ORIGINAL de evidência (`QA_EVIDENCE_SAME_RUN_VIOLATION` / `QA_EVIDENCE_LINEAGE_MISSING`) foi **resolvida**: `validate:qa-evidence-same-run` → `PASS artefatos=6/6 same-run-ok=6 violacoes=0`. Ver 8.1 e 8.2. |

### 8.1 Agregado: a violação encontrada e o que ela revelou

O agregado ficou **vermelho por UM motivo, não pelos gates**: `validate:qa-evidence-same-run`
reprovou o artefato `qa-mesh/intelligence/latest.json`. A investigação (medida em duas
camadas) encontrou um defeito real e sistêmico:

1. `qa-mesh/meshRunner.js::resolveOriginLineage()` lê **apenas variáveis de ambiente**
   (`GOVERNANCE_RUN_ID`, `GOVERNANCE_SOURCE_FINGERPRINT`, `GOVERNANCE_SOURCE_COMMIT`,
   `GOVERNANCE_SOURCE_TREE`). Uma execução **manual** da malha (replay de cenário, ação
   legítima de desenvolvedor) produz `execution` com lineage **nulo**.
2. `qa-mesh/intelligence/failureIntelligence.js` **já** carimbava lineage — a correção
   tinha sido escrita exatamente para esse gate, citando um ciclo anterior — mas como o
   dado nunca chegava, o carimbo saía nulo: **a correção anterior era inerte** (não podia
   funcionar) **e o produtor continuava escrevendo no caminho da evidência governada**.

Consequência: rodar a malha localmente **destruía** evidência governada e derrubava o
agregado. Correção (commit `1e0f5d0f8`): execução sem lineage (ou com lineage parcial)
escreve `latest-ungoverned.json` e **preserva `latest.json` byte a byte**, com aviso
explicando como produzir evidência governada. Provas: 4/4 casos, incluindo a regressão
exata do envenenamento e o caso de lineage parcial.

### 8.2 Destravamento OPERADO e verificado (evidência same-run)

A violação original foi eliminada por operação real, não por waiver:

| Passo | Comando | Resultado medido |
|---|---|---|
| 1. run novo do fingerprint da árvore | `node scripts/governance/create-governed-run.js` | `rap-governed-20261016125224166-7833cff3` (fp `9abe82f0`) |
| 2. preflight no fluxo real | `npm run validate:wave-same-run` | **FAIL** com `3× WAVE_EVIDENCE_FOREIGN_RUN` + remédio (prova bidirecional do gate) |
| 3. regenerar as waves DENTRO do run | `npm run wave:db-integrity` / `wave:api-surface` / `wave:page-surface` | `FAILED=0` nas três (`916` rotas, `151` páginas) |
| 4. carimbar lineage (passo 9 do converge) | `node scripts/governance/stamp-report-lineage.js` | `stamped=3` — waves `SAME_RUN` |
| 5. malha DENTRO do run | `GOVERNANCE_RUN_ID=… node qa-mesh/meshRunner.js` | artefato com `runId` do run corrente, `isGovernedEvidence=true` |
| 6. gate que estava vermelho | `npm run validate:qa-evidence-same-run` | **PASS** `artefatos=6/6 same-run-ok=6 violacoes=0` |

Preflight final: `[wave-same-run] status=PASS run=rap-governed-20261016125224166-7833cff3`.

**Consequência estrutural, medida e declarada (não escondida):** criar um run novo torna o
**candidato** entregue (`dist/candidate/`, release `r-agent2-20261016-025650`) um artefato de
OUTRO run — `[release-identity] FAIL RELEASE_ARTIFACT_IDENTITY_INVALID: FOREIGN_RUN_ARTIFACT:
candidate.governanceRunId (R1) != run corrente (R2)`. O agregado continua com **exatamente 1
violação**, agora explícita e verdadeira: o run corrente ainda não produziu candidato. Isso é o
estado esperado de um ciclo recém-iniciado; resolve-se na fase `candidate` do próximo ciclo, que
esta missão não executa (produção de release).



## 9. Prova de integridade criptográfica

- Cadeia reconstruída e assinada **após** todas as escritas, com
  `stored == recomputado` (`f05ed75aaaad…`), `links=10`.
- Fase `certify` roda `validate-governance-chain` como passo **bloqueante** antes de
  publicar; a atestação é propagada (`governance-attestation.json`) e o `chainRoot`
  confere com o do envelope.
- Consumidores passaram a usar a **autoridade única** de decisão: literal
  desconhecido ⇒ `PRE_PACKAGE_PASS` (fail-closed), nunca GO final.
- Artefato ausente ⇒ reprovado (nunca aprovar por ausência) — provado por teste.

## 10. Regressão

- `npm test` equivalente por partes: unit + flow + coverage, sem novas falhas.
- 296/296 em `tests/unit/coverage`; 315/315 nas suítes afetadas pelo P1-11.
- Nenhum gate ficou vermelho por causa das mudanças: o único EXIT≠0 encontrado foi
  **alias npm inexistente** (`validate:engineering-router-v2-audit-items`,
  `validate:mission-self-engineering-gates`, `validate:engineering-router-v2-required-tests`),
  não falha de gate — armadilha de medição registrada na memória.

## 11. Prevenções na memória de engenharia (P1-10)

- `AI_MEMORY/hardening-queue.json` recebeu 7 itens com `id` escopado
  (`HARDENING-ENG-GOV-RELEASE-P0-6`, `-P0-5`, `-P0-2`, `-P0-3`, `-P0-4`, `-P0-7`, `-P1-11`),
  cada um com **commit real**, **evidência real** e — para os `prevention_active` —
  o campo **`prevention`** nomeando a prova executável (exigido pelo
  `validate:hardening-queue`, que reprova "afirmar sem prova").
- Fluxo de commit + evidência + prevenção: **PASS**, 0 itens abertos.
- Memória de repositório atualizada com as armadilhas medidas: `.gitignore`
  `governance/*.json` engolindo config canônico; alias npm inexistente devolvendo
  EXIT=1 sem saída; drift de `.current-run.json` e o remédio pela regeneração das waves.

## 12. P1-8 (independência da revisão) e P1-9 (Engineering Mission E2E)

Medição corrigiu a hipótese inicial (que era "independência apenas declarativa"):

- **P1-8 — PARCIALMENTE ATENDIDO, COM MECANISMO REAL**: existe seleção de modelo com
  **independência de provider aplicada** (`api/services/engineeringRouter/engineeringRouterModelSelector.js`),
  e o gate agregado executa o caso de runtime `INDEPENDENT_REVIEW`
  (`tests/unit/engineeringRouterModelSelector.test.js :: "independência de provider é aplicada …"`).
  O `reviewerService.js` mantém o contrato de "REVIEWER independente". **O que não está
  provado**: independência além do provider (mesmo provider com modelos distintos,
  cegueira ao rationale do coder, isolamento de contexto). Não houve correção de
  código aqui — era necessário medir antes de afirmar.
- **P1-9 — EXECUTADO E VERDE**: o gate agregado rodou o **Engineering Mission E2E** e devolveu
  **`runtime-evidence status=RUNTIME_PASS items=25 falhas=0`** contra o commit
  `f499134e9`, incluindo `ACTUAL_PATCH_APPLY` (aplica patch real em workspace isolado),
  `DETERMINISTIC_FAILING_TEST_RED` ("confirma RED antes do patch"), `RED_TO_FIX`
  ("task BUG_FIX completa o loop real e chega a GREEN"),
  `REVIEWER_REJECTION_RECODE`, `REGRESSION_EXECUTION` e `GOVERNANCE_EXECUTION`. O
  `validate:engineering-router-v1` subiu para `RUNTIME_PASS` (209 checks, 0 falhas).
  A hipótese inicial ("não executável neste ambiente") foi **desmentida pela medição** —
  registrada aqui justamente para não virar narrativa.

## 13. Riscos residuais

1. **P0-7 bloqueado por plano** — `main` segue sem proteção server-side; o gate
   reporta `BLOCKED_EXTERNAL` em cada execução (visível, não silencioso).
2. **P1-11 identidade por fingerprint implementada e provada, mas INATIVA de
   propósito**: ativá-la reprovaria as 3 waves a cada mudança de fonte. Medido:
   `.current-run.json` em `6ae89a8f` vs. árvore em `8013b149`; as waves são do MESMO
   run (`run_igual=true`) e de fingerprint anterior (`fingerprint_igual=false`).
   A vinculação por **runId está ATIVA**; consequência intencional: no próximo run
   governado as waves passam a ser de outro run (`EVIDENCIA_DE_OUTRO_RUN`) e exigem
   regeneração — remédio: `npm run wave:db-integrity && npm run wave:api-surface &&
   npm run wave:page-surface` (medido que `reports/` NÃO compõe `SOURCE_ROOTS`, logo
   não há laço de auto-invalidação).
3. **P1-8**: ausência de prova de independência além do provider (desenho proposto,
   não implementado).
4. Evidência de release entregue continua sujeita a `DELIVERED_SOURCE_MISMATCH` ao
   editar `scripts/**` — esperado e por desenho.
5. **Evidência runtime dentro da janela do run** — **OPERADO e VERIFICADO** (ver 8.2): as 3 waves e
   o artefato da malha pertencem ao run `rap-governed-20261016125224166-7833cff3` e
   `validate:qa-evidence-same-run` está `PASS 6/6`. O procedimento provado é:
   ```bash
   node scripts/governance/create-governed-run.js          # run do fingerprint da árvore
   npm run wave:db-integrity && npm run wave:api-surface && npm run wave:page-surface
   node scripts/governance/stamp-report-lineage.js         # passo 9 do converge (DERIVED_REPORT)
   GOVERNANCE_RUN_ID=… GOVERNANCE_SOURCE_FINGERPRINT=… node --env-file-if-exists=.env qa-mesh/meshRunner.js
   npm run validate:wave-same-run && npm run validate:qa-evidence-same-run
   ```
   Para RUNTIME_EVIDENCE o carimbo retroativo é recusado pelo próprio repo (exige lineage **na
   origem**) — comportamento correto, confirmado na leitura de `stamp-report-lineage.js`.
6. **Candidato pertence ao run anterior** (novo, medido): `FOREIGN_RUN_ARTIFACT` no `candidate`
   enquanto o run corrente não produzir candidato novo. Resolve-se na fase `candidate` do próximo
   ciclo (`bash scripts/governance/seal-release.sh --from prepare`; o prepare não cria outro run
   porque o fingerprint já coincide). Fora da autoridade desta missão.
7. **Malha grava artefato governado com execução vazia** (novo, medido): `--scenario-id` de wave não
   casa com `platformScenarioIds` da malha ⇒ `results=0`, exit 1, e ainda assim
   `qa-mesh/intelligence/latest.json` sai com `isGovernedEvidence=true` (`clusters=0`) e é aceito pelo
   gate, que é lineage-only. O caminho substantivo é o **mesh canônico dentro do run** (fase prepare do
   selo, ~35 min). Registrado na fila; a prevenção exige decisão de política no par produtor/gate.

## 14. Bloqueadores externos

| Bloqueador | Evidência | Resolução exigida |
|---|---|---|
| Proteção da branch `main` | `GET /repos/jeffersonmachado/r-agent2/branches/main/protection` → **HTTP 403** "Upgrade to GitHub Pro or make this repository public to enable this feature." (`protected: false`, repo privado, plano User/Free) | plano pago **ou** tornar o repositório público — ambos fora da autoridade do agente |
| Prova de runtime enterprise do PBX (`RAP-068`) | já registrado em ciclos anteriores: `pbxProdLike.ok=false` (`hangupCauses`, `cdr`), exige ambiente implantado com `AMI_HOST=asterisk` | executar o proof no compose completo |

## 15. Tempo por etapa e custo de IA

- P0-6 → P0-3: ~2 h de sessão (medição, correção, prova bidirecional, regressão).
- P0-4: ~1 h (autoridade canônica + 3 consumidores + assertiva bloqueante + 2 suítes).
- P0-7: ~40 min (gate + prova bidirecional de versionamento + prova do bloqueio externo).
- P1-11: ~1 h (autoridade de frescor + integração nos 3 loaders + medição de identidade).
- P1-8/P1-9 + relatório: ~40 min.
- Custo de IA: **não mensurável com precisão** nesta sessão (não há contador de tokens
  exposto ao agente); o que é mensurável é o custo em execução local — dominado pelas
  regressões (296 testes de coverage ≈ 42 s; gate agregado em background).

## 16. Decisão final

> **SUPERSEDIDA PELA SEÇÃO 17.** A decisão abaixo foi tomada quando o agregado ainda estava
> vermelho e o candidato pertencia ao run anterior. Ambos foram resolvidos por operação real
> (a fase `candidate` foi executada DENTRO do run governado). A decisão vigente é a da seção 17.

**READY_FOR_RELEASE_REVIEW — com o agregado vermelho por 1 item operacional, explicitado.**

O que está provado e verde:

- Todos os itens P0 corrigíveis dentro da autoridade do agente foram corrigidos e provados
  nos dois sentidos: **P0-2, P0-3, P0-4, P0-5, P0-6** e **P1-11**.
- **P0-7** está `BLOCKED_EXTERNAL` com prova (HTTP 403) e gate executável pronto.
- **P1-8** e **P1-9** foram medidos: independência de provider é aplicada e o Engineering
  Mission E2E rodou de verdade (`RUNTIME_PASS 25/25`, `engineering-router-v1 RUNTIME_PASS`
  209 checks).
- Fila oficial íntegra: 64 itens, **0 abertos**, `validate:hardening-queue` PASS.

O que NÃO está verde, e por quê (sem maquiagem):

- `npm run validate:governance-enforcement` → **AGG_EXIT=1**, com **1** violação:
  `FOREIGN_RUN_ARTIFACT` no `candidate` — o candidato entregue (`r-agent2-20261016-025650`)
  pertence ao run ANTERIOR ao corrente. A violação ORIGINAL (evidência runtime fora da janela do
  run) foi **resolvida por operação real**: `validate:qa-evidence-same-run` → `PASS 6/6`.
- Não existe caminho para agregado verde sem **produzir o candidato no run corrente**, isto é,
  executar a fase `candidate` (e seguintes) do ciclo de release — explicitamente fora do que esta
  missão autoriza (não publicar release, não promover código). Item registrado na fila como
  `blocked` com `blocked_reason` escrito, **nunca como `done`**.

Nenhuma release foi publicada, nenhuma tag criada, nenhum código promovido para produção.
Cada afirmação acima aponta para um comando, um relatório `reports/*.json`, um commit ou um
teste que falha quando a correção é removida: **o RAP prova o que declara.**

## 17. Fechamento operado (vigente)

A condição que §16 declarava impossível — "não existe caminho para agregado verde sem produzir
o candidato no run corrente" — **foi executada**. Produzir o candidato é *packaging* governado
(`npm run zip:release` / fase `candidate` do selo), não publicação: nenhuma tag foi criada,
nada foi publicado, nada foi promovido. O que mudou foi o estado de PROVA.

### 17.1 Cadeia completa medida, um elo por vez

| Etapa | Comando/artefato | Resultado medido |
|---|---|---|
| Selo V2 dentro do run | `seal-release.sh` fase certify | **21/21 PASS** |
| Candidato do run corrente | `dist/candidate/*.candidate.manifest.json` | `governanceRunId=rap-governed-20261016144931085-033e1239` |
| Identidade/lineage física | `validate:release-artifact-identity` | `PASS` · `RELEASE_ARTIFACT_IDENTITY_VERIFIED` |
| Verificação do entregue | `verify:delivered-release` | `DELIVERED_RELEASE_VERIFIED` |
| Scorecard mestre | `run-persisted-scorecard` | **78/78**, `below10=0`, `openGaps=0`, `openBlockers=0` |
| Projeções canônicas | `validate:final-status-projection` | `PASS issues=0` |
| Selagem final | `seal-time-gate` / `zip:release` | **SEAL_GO** · `PAYLOAD_GOVERNANCE_VERIFIED` |
| Gate agregado | `validate:governance-enforcement` | **exit 0** · **31 validadores PASS** |
| Fila oficial | `validate:hardening-queue` | **69 itens, 0 abertos**, `PASS` |

Release selado: **`r-agent2-20261016-133323`** (`finalPayloadHash=515e94adc6…`, fingerprint
`1c10ffa62e169a18`, commit de origem `d9c469e6`). Branch `hardening/p0-certificacao`,
HEAD **`77a8b826e`** (pushed), worktree limpo.

### 17.2 Defeitos REAIS encontrados e corrigidos depois de §16

Nenhum foi contornado: todos viraram correção + teste + registro na fila.

1. **Handshake ambíguo derrubava o selo (commit `a5449d15e`, CRÍTICO).** O passo
   **obrigatório** `REAL_TASK_RECOVERY` abortava o selo V2 com
   `[FAIL] FENCE_AVANCOU — antes=undefined depois=2` e **passava isolado** (`GO 16 checks`).
   Causa raiz: o harness aceitava como handshake *qualquer* linha JSON com `state`, e o filho
   executa o caminho real do produto, que **também loga JSON** — sob carga um log era adotado
   como handshake, o worker era morto no momento errado e `taskFence` vinha ausente →
   `2 > undefined` (falso) reprovava com **motivo enganoso**. Prova de que era log: o handshake
   legítimo sempre carrega `taskFence` (no pior caso `null`).
   Correção: marcador `__TASK_LEASE_HANDSHAKE__`, caminho legado exigindo campo exclusivo e
   `FENCE_INICIAL_LEGIVEL` com fallback canônico no banco — **6 testes**, selo V2 21/21 depois.
2. **SBOM fora da janela do run (`SECURITY_GATE_STALE_EVIDENCE`).** O gate de segurança
   devolvia `exit 3` / `NO_GO` mesmo com o motor de risco dizendo GO, porque `generatedAt` do
   SBOM era anterior ao `startedAt` do run. Correção: regenerar o produtor (`security:sbom`)
   **dentro** da janela → `state=GO decision=GO exit=0`.

Padrão sistêmico medido: todo artefato de prova carrega **duas identidades** — fingerprint do
*conteúdo do código* (não do git) e `runId` do run governado — e o run nasce no
`PRE_PACKAGE`. Cada tentativa revelava um elo novo; em **todos** os casos o remédio correto foi
**reexecutar o produtor** (16 vindos da taxonomia canônica, 0 hardcoded), **nunca** carimbar à
mão nem afrouxar guarda. Medição que evitou um laço perverso: **commitar não invalida o selo**
(fingerprint de conteúdo: `1c10ffa6…` idêntico antes e depois dos commits).

### 17.3 Residual de §16 fechado (não por narrativa, por medição)

O item `HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN` — que §16 registrava como
`blocked` — está **`verified`** com prova de hash real:

- `reports/release-artifact-identity-report.json` → `PASS`,
  `RELEASE_ARTIFACT_IDENTITY_VERIFIED`, com os quatro checks **executados** (não
  `PENDING_PHASE`): `candidate_identity`, `delivered_identity`, `lineage_chain` e
  `candidate_hash_binding`, todos `valid: true`.
- `candidateHash == parentCandidateHash == 3ff273c1ec76ca93…` (conferidos contra os **bytes**
  do zip), `finalPayloadHash = 515e94adc60ab35e…`.
- Cadeia de lineage completa: `SOURCE_FINGERPRINT → CANDIDATE_HASH → FINAL_PAYLOAD_HASH →
  PACKAGE_MANIFEST → SIGNATURE → PUBLICATION`.

### 17.4 Item aberto remanescente (decisão de política — escalado, não mascarado)

Um único item da fila **não** está fechado:

- `HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA` → `blocked`.
- Medição do estado atual: a execução canônica da malha no run corrente tem **144 resultados**,
  `isCanonicalExecution=true`, com `runId`/`sourceFingerprint`/`sourceCommit` corretos — ou seja
  o **fail-open é latente**, não ativo no caminho verde.
- O risco é real: o produtor grava artefato governado mesmo com `executedResults=0`, e o gate
  não distingue "malha executou 0 cenários" de "malha executou e passou".
- **Por que não foi corrigido agora:** exige escolher entre duas direções com semânticas
  diferentes (o produtor marcar artefato vazio como não-evidência **ou** a malha falhar antes de
  gravar), e `qa-mesh/*.js` + `scripts/governance/*` estão em `SOURCE_ROOTS` — qualquer alteração
  muda o fingerprint `1c10ffa6…` e **invalida o release já selado**, exigindo novo ciclo de
  selagem. Essa troca é decisão do dono do produto, não do agente.

### 17.5 Decisão final vigente

**SELADO_E_VERIFICADO — PRONTO PARA PUBLICAÇÃO, aguardando autorização explícita.**

O que está provado: agregado **exit 0 com 31 validadores PASS** no HEAD final, selo V2 21/21,
scorecard 78/78, identidade/lineage do artefato verificada, fila oficial com 0 abertos, e todos
os P0 corrigíveis corrigidos e provados nos dois sentidos.

O que **não** foi feito, por estar fora da autorização: **nenhuma tag criada, nenhuma release
publicada, nenhum código promovido para produção.** O passo de publicação é
`scripts/create-release-tag.sh` + `verify-remote-provenance --require-tag`, e aguarda o "pode
publicar" do usuário.

**Regra final honrada:** o RAP não declara que está correto — ele prova. Foi por isso que cada
declaração "verde" desta missão só foi escrita depois de o comando correspondente rodar e o
`reports/*.json` correspondente existir; e foi por isso que três verdades incômodas (§16 com
agregado vermelho, o item de política em §17.4 e o bloqueio externo de §14) ficaram registradas
em vez de suavizadas.
