# ENGINEER_SUPERVISED_READINESS — Missão L-1 (RAP / r-agent2)

> **Veredito: `CANDIDATE_GO_SUPERVISIONADO`** (não é GO)
>
> L0, L1, L2, a bateria de negativos e o gate `--runtime` foram executados e estão verdes; a
> jornada supervisionada foi medida de ponta a ponta (8/8). O veredito **solicita auditoria
> independente** do código e das evidências. Permanecem pendentes: aprovação humana **real** de uma
> missão, o gate agregado (bloqueio externo de identidade de run) e toda ação de release/promoção.
> Este relatório é **evidência candidata**, não certificação independente.

| Campo | Valor |
|---|---|
| Data da avaliação | 2026-10-20 |
| Branch | `dev/engineering-hardening` |
| SHA do código medido | `42dd5f34b` (L1/L2, clone) e `5a26cab7c` (L0/runtime, worktree) |
| SHA remoto no fechamento | tip de `origin/dev/engineering-hardening`, confirmado por `git ls-remote`. O relatório cita `99a4f48b6` como commit do ciclo e é publicado no commit imediatamente seguinte (autorreferência de SHA é impossível) |
| Escopo | Preparação e comprovação da delegação supervisionada (L-1). **Não** é implantação do StudioOly, **não** é release |
| Commit final do ciclo | `99a4f48b6`, precedido por `5a26cab7c`, `42dd5f34b`, `1eca5ebbf`, `9d26a4ce6`, `cc4295226`, `070f303d7`, `fb525c989` |
| Worktree | limpo no momento da publicação (`git status --short` vazio) |

---

## 1. Escopo da missão

Tornar o Engenheiro tecnicamente seguro para receber, sob supervisão humana, a missão de corrigir e
homologar o RAP Fitness + EVO para a primeira implantação no StudioOly. Nesta execução:

- nenhum dado real de cliente foi tocado;
- nenhuma release foi publicada e nenhuma tag foi criada;
- `main` não foi alterada;
- todo trabalho foi publicado em `dev/engineering-hardening` com `git push origin HEAD`.

## 2. Componentes avaliados (inspeção + execução)

| Componente | Onde | Estado medido |
|---|---|---|
| Engineering Router (attempt loop) | `api/services/engineeringRouter/engineeringRouterService.js` | L0/L1 verdes; falha fechada de fonte de contexto corrigida (ciclo 1) |
| Fonte de contexto / base da task | `api/services/engineeringRouter/contextBuilderService.js` | **corrigido** (ciclo 1) |
| Sandbox de execução | `api/services/engineeringRouter/executionSandbox.js` | fronteiras ER-V1-SEALFIX-003 provadas em container real (4/4) |
| Runner containerizado | `services/engineering-runner/Dockerfile` | **corrigido** (ciclo 3) — imagem não subia dependências |
| Engineering Mission (gates) | `engine/engineeringMission/metaReview.js`, `missionReviewService` | `MR-06` aceita apenas `PASS` (ou `NOT_APPLICABLE` com `evidence.policySource`) |
| Aprovação humana | `api/services/engineeringMission/missionApprovalService.js` | `approve/reject/edit` exigem ator e lease da missão |
| Promotion (não publica release) | `api/services/engineeringRouter/promotionService.js` | nunca `git push`, nunca release, nunca merge remoto |
| Estado de release | `engine/governance/releaseStateModel.js`, `api/services/devGovernance/releaseStateService.js` | **corrigido** (ciclo 2) |
| Engineering Memory | `AI_MEMORY/hardening-queue.json` | 110 itens; 3 novos registrados com commit + teste |
| Prevenção | `tests/unit/engineeringMission/preventiveRules.test.js`, `tests/unit/engineeringRunnerDockerfileClosure.test.js` | ativa |
| Tenant isolation | `tests/integration/crmTenantIsolation.postgres.test.js` + fila | verificado (item `P0-TENANT-ISOLATION-*` fechado) |
| RAG operacional x interno | `docs/rag/domain-segregation.md`, `api/services/rag/domainRouter.js` | segregação por coluna antes da busca vetorial |
| CI/CD | `.github/workflows/release-governance.yml` | **bloqueado_external** (`MISSAO-B9-CI-GITHUB-ACTIONS`: budget) |

## 3. Correções realizadas neste ciclo

### 3.1 `6ecca330c` — contexto do CODER não degrada mais para o checkout principal (item F)

Defeito: `createSourceReader` lia `ROOT` quando o `source_commit` declarado pela task era
irresolvível (só `logger.warn`), enquanto `patchApplyService.resolveTaskBaseCommit` já falhava
fechado. O CODER era despachado com o contexto de **outra base**.

Correção: declarou base, ela precisa existir. Attempt fechado com `CONTEXT_SOURCE_UNRESOLVABLE` +
`reason` estável (`MISSION_SOURCE_COMMIT_UNRESOLVABLE` / `MISSION_SOURCE_NOT_INHERITED`), task
`FATAL`, nenhum CODER despachado. Task avulsa sem base declarada continua lendo `ROOT`.

### 3.2 `ce343edd3` — entrega só é "verificada" com prova canônica (itens A e C)

Três defeitos medidos:

1. `deriveReleaseState` **recebia** `blockers`, `evidenceUnavailable` e `deliveredVerdict` e **nunca
   os consultava** — bastava existir arquivo em `dist/release` com HEAD == commit do run.
2. predicado positivo era `/VERIFIED/i` (**substring**): `NOT_VERIFIED`/`UNVERIFIED` passavam.
3. o serviço lia `reports/delivered-release-verification-report.json`, mas o produtor
   (`governance/verify-delivered-release.js`) grava em `governance/` — a evidência nunca era lida.

Correção: veredito `DELIVERED_UNVERIFIED` + `verificationGaps` auditáveis; decisão por pertinência
**exata** a `DECISOES_ENTREGA_PERMITIDAS` (guarda de divergência em teste); caminho único vindo de
`DECISION_REPORTS`; exige veredito positivo, zero bloqueios, evidência disponível e identidade de run.

### 3.3 `53da93267` — container real do Runner executava sandbox com `MODULE_NOT_FOUND`
Reproduzido **ao vivo** (`docker run … + POST /execute`):

```json
{"error":"Cannot find module '../../../governance/bug-closure/command-policy'","code":"MODULE_NOT_FOUND"}
```

Causa: `executionSandbox.js` passou a exigir `governance/bug-closure/command-policy` (cadeia
`eligibility`/`defect-registry`/`defect-states`) e o `Dockerfile` nunca copiou. Fechamento medido:
**12 arquivos** alcançados por require relativo fora da imagem. Prevenção:
`tests/unit/engineeringRunnerDockerfileClosure.test.js` calcula o fechamento transitivo e reprova
arquivo sem `COPY`.

### 3.4 `fb525c989` — `publish-tag` exige entrega verificada (item B)

Defeito: `deriveReleaseState` oferecia a ação `publish-tag` quando existia `releaseName` e nenhum
guard local bloqueava — mesmo com gate canônico vermelho, sem relatório de entrega ou com identidade
de run incompleta. Publicar tag é ato de release; "estar selado" não é "estar verificado".

Correção: a ação passa a exigir `verdict === DELIVERED_VERIFIED`, e o `blockedReason` nomeia os
códigos das lacunas. A autorização explícita já existia e continua obrigatória: `runReleaseAction`
recusa ação mutante sem `confirm: true` (`confirmation_required`), o catálogo é allowlist fechada e
`assertPreconditions` deriva da **mesma** fonte de estado (a API recusa antes do efeito).

## 4. Testes executados (medições reais)
| Camada | Comando | Resultado |
|---|---|---|
| L0 | `npx jest "tests/unit/engineering" tests/unit/governance --bail=0` | **exit 0** — 2 skipped, **2762 passed**, 2764 total (45,7 s) |
| L1 (isolado, 3 suítes que falharam em lote) | `npx jest … --runInBand` | 8/8 passed (84,9 s) |
| L1 (container real) | `npx jest tests/integration/engineeringRunnerComposeDeploymentE2E.test.js --runInBand` | **exit 0** — 4/4 passed (15,7 s) |
| L0 (fechamento do Dockerfile) | `npx jest tests/unit/engineeringRunnerDockerfileClosure.test.js` | exit 0 — 2/2 |
| L1 (bateria completa) | `npx jest "tests/integration/engineering" tests/contracts/engineeringCoderReviewerService.test.js --maxWorkers=2` | **exit 0** — **40 suítes / 221 testes passed** (404,9 s) |
| Política do agente | `node governance/verify-agent-policy-compliance.js` | `AGENT_POLICY_COMPLIANCE_PASS` |
| L0 governança (após ciclo 4) | `npx jest tests/unit/governance --bail=0` | **exit 0** — 172 suítes / **1816 passed** (2 skipped) |

### 4.1 Falhas de L1 em lote: o que aconteceu e como foi classificado

Primeira bateria com paralelismo padrão (12 workers): 40 suítes, 221 testes, **17 suítes / 29 testes
falharam**. Todas as mensagens eram `SANDBOX_UNAVAILABLE` / `INFRA_ERROR` — **zero** ocorrências dos
códigos novos (`CONTEXT_SOURCE_UNRESOLVABLE` etc.), ou seja, não era a regra do ciclo 1.

Reexecução com `--maxWorkers=2`: **4 suítes / 5 testes falharam**, 216 passed. Isoladas: 3 passaram
8/8; a quarta (`engineeringRunnerComposeDeploymentE2E`) falhou de forma determinística — e a causa
**não era contenção**: era o `MODULE_NOT_FOUND` do §3.3, corrigido e re-provado em container real.

Leitura honesta: a maior parte das falhas em lote é **contenção de sandbox Docker** (mesma classe já
registrada em `AI_MEMORY/evidence/2026-10-07-human-external-bootstrap-context-source-coherence.json`),
mas **uma delas era defeito real** e só apareceu porque a suíte foi rodada isolada. Nenhuma falha foi
mascarada, `skip` não foi introduzido e nenhuma asserção foi enfraquecida.

**Bateria definitiva no HEAD publicado (`713aafc1a`, já com o `Dockerfile` corrigido):**
`--maxWorkers=2` → **exit 0, 40 suítes / 221 testes, todos passed (404,9 s)**. As 17 suítes / 29 testes
vermelhos da primeira tentativa não eram regressão de produto; a única falha determinística entre elas
era o container quebrado do §3.3.

### 4.2 Nota sobre contenção (risco de leitura errada do vermelho)

O paralelismo padrão (12 workers) deste ambiente **não** suporta a bateria de integração do Router:
cada suíte sobe containers reais e o sandbox fica indisponível (`SANDBOX_UNAVAILABLE`). Duas
consequências práticas: (a) "17 suítes vermelhas" não é sinal de regressão e (b) rodar só o lote
também **esconde** defeito real (o `MODULE_NOT_FOUND` do §3.3 apareceu porque uma suíte foi isolada).
A leitura correta é sempre: lote com contenção reduzida **e** isolamento das que falharem.

### 4.3 Incidente de trabalho: worktree mutado por sessões concorrentes (medido)

Durante a certificação o worktree foi alterado **enquanto a medição rodava**. Evidência objetiva —
três fingerprints distintos para o mesmo instante de referência:

| Origem | `sourceFingerprint` |
|---|---|
| evidência de runtime gravada em uma das rodadas | `15bc43e9…` |
| worktree principal no momento da verificação | `128f32f5…` |
| clone limpo do commit publicado | `e823bdca…` |

O gate compara a evidência com o código **no instante da verificação**: fingerprint que muda entre
coleta e verificação produz `RUNTIME_EVIDENCE_FRESH` falso — ou seja, certificação impossível por
construção enquanto a árvore muda.

Esse incidente tem duas consequências registradas:

1. **Um commit meu foi contaminado e revertido.** `3490286e3` levou junto um `package.json` que não
   era o do repositório (removia `overrides`, `validate:anti-greenwashing`,
   `validate:engineering-router-v2`, `validate:migrations`…). Detectado por auditoria de `git show
   --stat`, revertido em `070f303d7` (conteúdo idêntico a `dc4f9904c`, `git diff` vazio).
2. **A causa raiz foi identificada e hoje tem guarda.** O item `L1-WORKTREE-MUTILACAO-RECORRENTE`
   (`prevention_active`, commit `cc4295226`) registra: duas sessões de agente editando o mesmo
   worktree ao mesmo tempo — uma executando o coletor ER-V1 e suítes de integração, a outra
   restaurando arquivos de HEAD. Prevenção: `validate:worktree-integrity`, hooks versionados que
   recusam `TEST_CASE_REMOVAL`/`SYMBOL_REMOVAL`/`PURE_DELETION`/`DELETION_DOMINANT`, trava de sessão
   única e `patchValidator` recusando patch que apaga casos de teste.

Lição operacional: nenhuma medição é válida sem `git status` limpo **antes e depois** da execução; o
relatório passa a registrar o snapshot nos dois extremos.

### 4.4 Evidência de runtime: defeito de reprodutibilidade corrigido no coletor

`EXACT_PATCH_PROMOTION` e `PROVIDER_MODEL_FAILURE_REROUTE` falhavam em árvore limpa (`promoted=false`,
`READY_FOR_PROMOTION`) e passavam quando havia estado residual — enquanto a suíte inteira passava
221/221. Causa: o coletor executava `jest <arquivo> --testNamePattern <id>`, isto é, **só o teste
nomeado**, quebrando testes que dependem de estado produzido por outro teste do mesmo arquivo.
Correção em `42dd5f34b`: roda o arquivo inteiro (o mesmo comando do gate L1) e extrai o veredito do
teste-alvo de `assertionResults`. Item `L1-RUNTIME-EVIDENCE-NAO-REPRODUZIVEL`.

**Resultado medido após a correção (árvore limpa, `42dd5f34b`, `dirty=0` antes e depois):**
coleta `EXIT=1` com **1 item reprovado** — `REVIEWER_REJECTION_RECODE` — e gate
`status=FAIL (STRUCTURAL_PASS/RUNTIME_FAIL) checks=209 falhas=1`.

O mesmo item, executado **diretamente**, passa: `npx jest
engineeringRouterReviewerRejectionRecodeE2E.test.js --runInBand` → **PASS, 1/1, 81,6 s**. E a suíte de
promoção, que reprovou nos ciclos anteriores, passa isolada **7/7 em 170,2 s**. Cada execução da
coleta reprova um item DIFERENTE (promoção → reroute de provider → reviewer recode), sempre
dependente de promoção, e sempre reexecutado com sucesso fora do coletor.

Conclusão honesta: **é o instrumento de coleta que não é estável neste ambiente, não o produto** —
25 arquivos E2E sequenciais acumulam 2.910 branches residuais `engineering/missions/*`, workspaces e
linhas de banco entre itens, e o processo Jest do item reprovado morre antes de emitir o JSON. Isso
impede declarar `RUNTIME_PASS` reproduzível (critério 7), mesmo com os testes passando por comando
direto. Próximo passo técnico: isolamento/limpeza entre itens (branch pruning + limpeza de workspace
e de linha) e captura de OOM/sinal no item reprovado.

**Reexecução com a árvore livre (2026-10-20T19:18Z, `5a26cab7c`, nenhuma sessão concorrente):**
`npm run collect:engineering-router-runtime-evidence` → **`status=RUNTIME_PASS`, 25 itens, 0 falhas**,
fingerprint `72882145a443635f…`. Isso confirma a leitura acima: a instabilidade observada era
**contenção** (runner compartilhado e suíte paralela), não o produto nem uma limitação permanente do
coletor. O `RUNTIME_PASS` agora existe — mas a reprodução continua dependendo de **uma única sessão
por worktree**, que é exatamente o que a guarda de integridade e a trava de sessão passaram a
registrar e recusar.

### 4.5 L1/L2 medidos em clone isolado (árvore principal ocupada por outra sessão)

Durante a janela, outra sessão de agente editava o worktree principal. Para medir sem contenção,
L1 e L2 rodaram em clone do commit `42dd5f34b` — **mesmo código do HEAD `5a26cab7c`** (o delta é
apenas este relatório e a fila). Receita: clone local (nunca `--shared`, que cria
`objects/info/alternates` e quebra `git status` dentro do sandbox), `.env` e `api/data/config.json`
copiados, `node_modules` por symlink, `ENGINEERING_ROUTER_HOST_REPO_ROOT`/`WORKSPACE_ROOT` do clone
e runner em porta própria.

| Camada | Comando | Resultado |
|---|---|---|
| L0 | `npx jest tests/unit/engineering tests/unit/governance --bail=0` (worktree principal, `5a26cab7c`) | **exit 0 — 256 suítes / 2782 testes** (2 skipped) |
| L1 | `npx jest tests/integration/engineering tests/contracts/engineeringCoderReviewerService.test.js --maxWorkers=2` (clone, `42dd5f34b`) | **exit 0 — 40 suítes / 221 testes** |
| L2 | `npx jest tests/integration/engineeringMissionFullE2E.test.js --runInBand` (clone, `42dd5f34b`) | **exit 0 — 8/8** |
| Negativos | 10 suítes de bloqueio (escopo, self-modification, governança, tenant) | **exit 0 — 110 testes** |

A primeira tentativa de L1, com isolamento errado, deu 34/40. As 6 falhas foram classificadas uma a
uma e **todas eram artefato do isolamento**, não do produto: `ENGINEERING_ROUTER_HOST_REPO_ROOT` do
`.env` apontando para o repositório principal (promoção, candidate split, durable resume),
`WORKSPACE_ROOT` compartilhado (pruning) e `git clone --shared` (o `git status` do sandbox morria com
`bad object HEAD`). Corrigida a configuração, cada uma passa isolada e a bateria fecha 40/40.

L2 prova a jornada inteira: missão em linguagem natural → enriquecimento → `AWAITING_APPROVAL` →
**execução bloqueada antes da aprovação** → aprovação libera exatamente a versão aprovada →
EngineeringTask aderente → **loop real do Router chega a GREEN (73,6 s)** → relatório de auditoria →
TEST 48. Ressalva: a aprovação é programática no teste (ator distinto); prova o mecanismo de
bloqueio/liberação, **não** substitui assinatura humana real.

Evidências transitórias: `/tmp/l0-main-final.log`, `/tmp/l1-full-completo.log`,
`/tmp/l2-iso-missao2.log`, `/tmp/negatives.log`. A prova durável é o commit + os testes.

### 4.6 Auditoria de reprodutibilidade no commit publicado (`4298d2427`)

Clone limpo do commit publicado, raízes próprias e runner em porta dedicada: L1 deu **38/40 suítes,
219/221 testes**. As duas falhas são de naturezas diferentes:

1. `engineeringRouterConcurrentRunHttp` — **defeito real**: duas requisições simultâneas receberam
   `202` e a execução foi aceita duas vezes (`[202, 202]` em vez de `[202, 409]`). Causa:
   `runnerId = http-<agent>-Date.now()` colide no mesmo milissegundo e a cláusula de reentrada do
   lease (`lease_worker_instance_id = :workerInstanceId`) reconhece o segundo pedido como o mesmo
   worker, re-adquirindo o lease em vez de recusar. Corrigido em `867b47e30` (identidade por
   `crypto.randomUUID()`, o mesmo padrão de `newRunnerId()`); a suíte passa **10/10** execuções
   após a correção. Item `L1-CONCORRENCIA-HTTP-DUPLO-ACCEPT`.
2. `engineeringBugLoopNaturalPathE2E` — **timeout de 900 s no lote**; isolado passa em 44 s (e já
   passou em baterias anteriores). Flake de contenção, declarado como tal: não foi tratado como
   verde nem como defeito de produto.

Nenhuma das duas foi mascarada: a primeira virou correção com regressão permanente; a segunda ficou
registrada como flake.

**Rechecagem no tip publicado (`2822e9854`, clone limpo):** as duas suítes passam —
`engineeringRouterConcurrentRunHttp` devolve `202/409` e `engineeringBugLoopNaturalPathE2E` fecha em
50,7 s. O defeito de concorrência não existe mais no código publicado; o timeout do bug loop segue
como flake declarado sob carga.

### 4.7 Ciclo de hardening P0/P1 da auditoria externa (baseline `40042f1a3`)

| ID | Defeito medido | Correção | Prova |
|---|---|---|---|
| `P0-FILAS-ROLLBACK-DESTRUTIVO` | rollback chamava `deleteQueue(name, true)` e fechava tickets ativos — inclusive de fila **preexistente** | `created:true|false` + rollback escopado **sem** force | `queueCreatePersistBeforeResponse` com helpers reais; 157/157 filas |
| `P0-FILAS-ISOLAMENTO-TENANT` | exclusão forçada do tenant A fechava tickets do tenant B (mesmo nome de fila); listagem mesclava nomes globais | `tenantId` em list/create/delete/info (índice, serviço, módulo e handler legado) | `queueTenantIsolation.test.js` (5 casos) |
| `P1-REVISAO-INDEPENDENCIA-SO-NEGATIVA` | `Boolean(approvedReview) && !independentContradicted` aceitava APPROVE **sem** declaração de independência | prova positiva: declaração + identidade completa + provider distinto | gates 10/10; integração 16/16 |
| `P1-UNIT-GATE-ACEITA-UNKNOWN` | gate `unit` usava `testsAllPass` (qualquer execução verde, inclusive UNKNOWN) | exige run classificado como UNIT com PASS/exit 0 | 443 unit; enforcement 7/7 |
| `P1-CONCORRENCIA-EXIGE-POSTGRES` | `if (skipIfNoDatabase()) return;` → PASS sem executar | `INFRA_ERROR` explícito + sonda `SELECT 1` | passa com banco; falha com `DATABASE_URL` inválida |
| `P1-GUARDA-SKIP-ASSERTIONS-COMMITS` | guarda só contava declarações; pre-push comparava com o **worktree**, não com o commit enviado | `TEST_SUPPRESSION_ADDED`, `ASSERTION_REMOVAL`, `--head <sha>` por ref, waiver com `--approved-by` | 14/14; mutação **commitada** bloqueada (exit 1) |

Regressão deste ciclo: `npx jest tests/unit` → **1080 suítes / 9174 testes, exit 0**
(2 skipped declarados). Nenhum teste foi removido ou enfraquecido para obter verde;
os contratos alterados foram migrados explicitamente e estão nomeados nos commits.

### 4.8 Integração real no gate do branch — e os dois defeitos que ela expôs

Até `a67a99835` o gate do branch de desenvolvimento **não rodava nenhuma suíte de integração**:
`dev-branch-ci.yml` executava `npm test` (unit + flow + rpa) e gates de governança, e o job de
integração existia apenas em `jest.yml`, que dispara em `main`/`develop`. Nenhum commit desta branch
passava por Postgres real.

Correção (`a67a99835`): passo **L0b** em `scripts/ci/dev-branch-gate.js`
(`npx jest tests/integration/engineering --bail=0 --maxWorkers=2 --forceExit`, fail-closed — sem
banco o passo falha, não pula) e job `dev-branch-integration` no workflow, com serviços
`pgvector/pgvector:pg16` + `redis:7` e migrations.

A primeira execução do passo reprovou **duas** suítes, e as duas eram defeito real:

| Achado | Diagnóstico | Prova |
|---|---|---|
| `P1-MERGE-MISSAO-PERDA-DE-ATUALIZACAO` (`697381bbb`) | `mergeMissionJson` fazia read-modify-write puro: duas escritas concorrentes partiam do mesmo snapshot e a última vencia com o snapshot **antigo**, apagando a chave da outra. O coordenador do Bug Loop logava `replacementTaskId` novo (`635d254e…`) e a missão persistida ficava com a lineage anterior (`= originalTaskId`) | `engineeringMissionMergeConcurrency.test.js` (5 casos; 15 rodadas concorrentes). Código **antigo**: 1 falha. Fix: 5/5 |
| `P1-PROMOCAO-SMOKE-INSTAVEL-SOB-CARGA` (`c4770aa55`) | `engineeringPromotionService` reprovou **só na bateria** (`promoted:false`); isolada passa 10/10. O smoke pós-promoção executa um `npx jest` dentro do workspace e, sob carga, pode exceder o deadline → `TIMEOUT` → `POST_PROMOTION_VERIFY_FAILED`. Diagnóstico estava invisível (`Expected: true, Received: false`) | asserção passou a reportar o `code`; bateria seguinte: **40/40 suítes, 219/219 testes, exit 0 (577 s)** |

Correção do merge, em detalhe: CAS por `updatedAt` (o model é `underscored: true` — usar
`updated_at` no `WHERE` gera `WHERE parameter ... invalid "undefined"`), reaplicando o merge sobre o
estado **relido**, 5 tentativas e `MISSION_MERGE_CONFLICT` explícito em vez de sobrescrever. O
caminho com `guard.leaseToken` continua em `updateMissionGuarded` (já condicional por lease/fence).

**Medição final da bateria (árvore limpa, `697381bbb`):** 40/40 suítes, 219/219 testes, exit 0,
577 s. A falha de promoção não se repetiu; ela permanece classificada como instabilidade de
contenção (a mesma classe documentada em §4.4), agora **diagnosticável** pelo `code`.

### 4.9 Resíduo de refs `engineering/missions/*` (medido, poda pendente de aprovação)

`git branch --list 'engineering/missions/*' | wc -l` → **3.017** (mais 86
`engineering-router/candidates`), sem **nenhuma** poda em código de produção
(`grep deleteBranch|branch -D` em `api/services/engineeringRouter|engineeringMission` → zero). Cada
execução da bateria cria ~22 branches novas (2.995 → 3.017 medidos).

`scripts/prune-engineering-mission-branches.js` (`c4770aa55`) classifica por missão no banco e é
dry-run por padrão:

| Classe | Quantidade | Ação |
|---|---|---|
| órfã (missionId inexistente no banco) | 2.738 | candidata |
| fixture de teste (`created_by` com marcador) | 269 | candidata |
| missão de usuário viva | 10 | **mantida** — nunca é candidata |
| **total de candidatas** | **3.007** | requer `--apply` |

Sem banco acessível **nada** é candidato (`INFRA_ERROR`, exit 2): "não sei se a missão existe" nunca
vira "pode apagar". **Aprovado e aplicado** em 2026-10-21 por decisão explícita do dono do
repositório: `--apply` → `status=PASS, aplicadas=3007, falhas=0`, refs **3.017 → 10** (as 10
preservadas são de missões de usuário vivas; nenhuma delas é candidata por construção).

### 4.10 §8 — auditoria adversarial do isolamento de execução

Objetivo: tentar QUEBRAR o isolamento, não descrevê-lo. Cada linha é um vetor, o mecanismo que o
contém e a prova que o mantém contido.

**Achado novo, explorável e corrigido (`bd376df01`): escape por SYMLINK no patch.**
`validatePatch` aceitava `new file mode 120000`. Nesse modo o CONTEÚDO do arquivo é o ALVO do link:
o caminho tocado (`tests/fixtures/link`) fica dentro de `allowedPaths` — a fronteira de path compara
o NOME, não o destino — e `git apply` materializa um symlink real. Medido:
`{ gitApply: 'ok', isSymlink: true, target: '/etc/shadow', validadorAceitou: true }`, idem para
`../../.env`. Diff canônico, tree hash e smoke não detectavam: todos tratam o caminho como arquivo
comum. Correção: parser expõe `gitMode`/`isSymlink` (inclusive via `index <a>..<b> 120000`) e
`validatePatch` recusa **qualquer** symlink com `PATCH_SYMLINK_FORBIDDEN`, fail-closed; a única
aceitação possível é campo explícito de contrato (`symlinkAuthorization: true`), auditável.
Prova: `engineeringRouterPatchSymlinkEscape.test.js` — **7/7** com o fix, **4 falhas** no código
anterior (os 3 controles passam nos dois sentidos, então o teste não é vacuoso).

| Vetor | Mecanismo que contém | Prova |
|---|---|---|
| Patch cria symlink para fora do repo | `PATCH_SYMLINK_FORBIDDEN` (novo, `bd376df01`) | `engineeringRouterPatchSymlinkEscape` 7/7; 4 falham no código antigo |
| Path traversal (`..` escapando) | `parseUnifiedDiff`/`resolvePathSegments` colapsa `..`; `PATH_ESCAPES_ROOT` | `engineeringRouterPathBoundary` |
| `allowedPaths` ausente/vazio | fail-closed: nenhum caminho aceito (nunca "tudo permitido") | `engineeringRouterPathBoundary` |
| `forbiddenPaths` vs `allowedPaths` | `forbidden` sempre vence, mesmo após resolver `..` | `engineeringRouterPathBoundary` |
| Patch apaga casos de teste | `PATCH_REMOVES_TESTS` (autorização só por contrato) | `engineeringRouterTestRemovalPolicy` |
| Patch embute segredo | `findSecretsInAddedContent` → `PATCH_CONTAINS_SECRET` | `patchValidator` + suíte do Router |
| Patch toca gates/CI/governança | `INTEGRITY_CRITICAL_PATH_PATTERNS` → `PATCH_FORBIDDEN_FILE` | `patchValidator` |
| Execução sem Docker | `SANDBOX_UNAVAILABLE` fail-closed, **sem** fallback para host | `engineeringRouterMandatoryRuntimeGate`, `engineeringRouterExecutionSandboxSecurity` |
| Rede no sandbox | `--network none` | `engineeringRouterExecutionSandboxSecurity` |
| Docker socket do host | não é montado | idem |
| Escrita fora do workspace | raiz read-only + bind do workspace | idem |
| `node_modules` real corrompido | bind read-only (nunca o symlink gravável) | idem |
| `cwd` = repositório principal | recusa explícita (nunca chmod/mount no código real) | idem |
| Excesso de processos | limite de PIDs no container | idem |
| Timeout | `docker kill --signal=SIGTERM` → janela de grace → `SIGKILL` se ainda de pé; resultado carrega `timedOut`/`terminatedBy` | `executionSandbox` + `engineeringRouterExecutionSandboxSecurity` |
| Cancelamento concorrente no meio do run | transição a partir de `CANCELLED` tratada como resultado (`CANCELLED_MID_RUN`), nunca exceção não tratada | `engineeringRouterTolerantTransition` |
| Task já terminal na retomada | `TASK_ALREADY_TERMINAL_DURING_RESUME` devolve o status real | `engineeringRouterTolerantTransition` |
| Dois workers na mesma task | lease com fencing token; update condicional e `affected === 0` | `engineeringTaskFencing` (5 casos), `engineeringTaskConcurrencyAndRestart` (8) |
| Posse perdida | `LEASE_LOST` — o perdedor não escreve mais nada | `engineeringRouterService` + suíte de concorrência |
| Retomada após crash em PROMOTING | `findExistingCandidate` acha o candidate real; nunca promove duas vezes | `engineeringPromotionCandidateSplit`, ER-V1-SEAL-002 |
| Duplo `accept` HTTP concorrente | `runnerId` com UUID + lease com cláusula de reentrada | `engineeringRouterConcurrentRunHttp` (10/10) |

Medição de regressão desta seção: `tests/unit/engineeringRouter` + suíte nova → **39 suítes /
400 testes PASS**; `tests/unit/engineeringMission` + integração `patchAndTestRunner`/`promotion` →
**38 suítes / 457 testes PASS**.

### 4.11 §11 — segregação PRODUCTION/SUPPORT/DEVELOPMENT revalidada após as mudanças

Os três gates de segregação foram reexecutados depois de todas as mudanças acima (nenhuma delas
tocou menu, rotas ou `workspace.route-classifications.js`, mas revalidar é obrigatório):

| Gate | Resultado medido |
|---|---|
| `validate:visibility-policy` | `status=PASS violations=0` |
| `validate:experience-segregation` | `status=PASS surfaces=205 supportSurfaces=22 violations=0` |
| `validate:experience-api-segregation` | `status=PASS leaks={"productionTechnicalLeaks":0,"supportEngineeringLeaks":0,"directUrlBypasses":0}` |

Os relatórios versionados (`governance/experience-segregation-report.json`,
`governance/experience-api-segregation-report.json`) foram regravados pelos validadores e o
worktree permaneceu **limpo** — isto é, o payload é determinístico para o mesmo código (nenhum
artefato divergiu por efeito colateral da medição).

Ressalva declarada: estes três gates são **estáticos** (menu, rotas, classificações, conteúdo
proibido). A validação em **browser real** de que uma superfície DEVELOPMENT não aparece para
classificação PRODUCTION não foi reexecutada nesta janela — está registrada em §5.

### 4.12 Reprodução independente em janela congelada (commit `486a498cb`)

Medição feita por sessão distinta da que produziu §4.4–§4.5, com o VS Code reaberto (uma única
sessão) e **nenhuma edição** durante a execução. O ponto que §4.4 deixou em aberto — "o
`RUNTIME_PASS` agora existe, mas a reprodução depende de uma única sessão" — é o que esta seção
fecha: mesma árvore do início ao fim, atestada por snapshot.

```
SNAP_INI     23:15:46  head=486a498cb  dirty=0
coletor      EXIT=0    status=RUNTIME_PASS items=25 falhas=0  fingerprint=a27300759b468fea…
gate         EXIT=0    PASS (STRUCTURAL_PASS/RUNTIME_PASS) checks=209 falhas=0
L0           EXIT=0    1087 suítes / 9218 testes (2 skipped)   [13:34 de execução]
L1 (1ª)      EXIT=1    225/226 — 1 falha: engineeringBugLoopNaturalPathE2E (colisão de limpeza)
L1 (isolada) EXIT=0    PASS — 1/1, 84,8 s  (a mesma suíte que falhou no lote)
L1 (2ª)      EXIT=0    41 suítes / 226 testes
SNAP_FIM3    23:58:01  head=486a498cb  dirty=0
```

Prova de janela: `head` idêntico e `dirty=0` em **todos** os snapshots
(`AI_MEMORY/evidence/l1-2026-10-20/certificacao-snapshots.txt`).

Sobre a falha da 1ª tentativa de L1: foi `purgeTestFindings` → `Finding.destroy` (limpeza de banco
em paralelo com outras suítes), não asserção de comportamento; a mesma suíte passa **isolada** em
84,8 s e o lote reexecutado fecha 41/41. Registrado porque esconder a tentativa vermelha seria
justamente o tipo de relatório que esta missão proíbe.

Artefatos versionados: `certificacao-snapshots.txt`, `certificacao-coletor.log`,
`certificacao-gate-runtime.log`, `certificacao-resumos.txt` (extratos de L0/L1; os logs completos
têm 1,3 MB e 0,5 MB e não são versionados — os comandos de reprodução estão em
`CERTIFICATION-WINDOW.md`).

## 5. Testes NÃO executados (declarado, com motivo)

| Não executado | Motivo |
|---|---|
| `npm test` completo (todas as raízes) | fora do escopo de L-1 nesta janela; o objetivo é a cadeia do Engenheiro, não a plataforma inteira |
| `npm run validate:governance-enforcement` (gate agregado) | **bloqueado_external**: não existe identidade de run governado no branch de desenvolvimento — item `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` (`blocked_external`) |
| `npm run release:seal` / `zip:release` | proibido pela missão (não publicar release) e bloqueado por `H15`/`H19`/`H20` (`blocked_external`) |
| Missão supervisionada de ensaio (item 10) com **aprovação humana real** | jornada executada de ponta a ponta em L2 (§4.5) com aprovação **programática** de ator distinto; a assinatura humana real não foi executada — exige decisão do usuário |
| Certificação do contrato EVO | fora do escopo explícito de L-1 (a missão diz que não é requisito) |
| QA Mesh / QA Waves canônicos | pertencem ao selo; o selo está `SEAL_PENDING` e não é objetivo de L-1 |
| Segregação em **browser real** (superfície DEVELOPMENT invisível para PRODUCTION) | os 3 gates de §4.11 são estáticos e PASS; a prova em navegador com `tests/helpers/playwrightAuth.js` não foi reexecutada nesta janela. Não é declarada como feita. |
| `--apply` da poda de branches | **executado** com aprovação do dono (3.017 → 10); registrado aqui porque era ação destrutiva e irreversível |

## 6. Resultado de cada gate (medido, sem narrativa)

| Gate | Resultado |
|---|---|
| L0 unit (engenharia + governança, `5a26cab7c`) | PASS (2782/2784, 2 skipped declarados) |
| L1 integração do Engenheiro (bateria completa, `42dd5f34b`) | PASS (40 suítes / 221 testes, exit 0) |
| L2 jornada supervisionada (`engineeringMissionFullE2E`) | PASS (8/8; loop real até GREEN em 73,6 s) |
| Bateria de cenários negativos (10 suítes de bloqueio) | PASS (110 testes, exit 0) |
| Container real do Runner | PASS (4/4) após correção do `Dockerfile` |
| Fechamento de dependências da imagem | PASS (2/2) |
| Política do agente (Constituição) | PASS |
| Gate do Router V1 — `STRUCTURAL` (árvore publicada) | PASS — 183 checks, 0 falhas |
| Gate do Router V1 — `--runtime` (evidência do commit) | **PASS (RUNTIME_PASS)** — 25/25 itens, `sourceCommit=5a26cab7c`, coleta de 2026-10-20T19:18Z. As reprovações anteriores eram contenção do ambiente (§4.4) |
| `validate:bug-closure-status` | PASS — 9/9 entrypoints guardados, 13 provas de mecanismo |
| `validate:hardening-queue`, `route-mounts`, `ai-memory`, `ai-memory-consistency`, `agent-adherence` | PASS |
| Gate agregado de governança | **NÃO EXECUTADO** (bloqueio externo de identidade de run) |
| Selo de release | `SEAL_PENDING` (não perseguido nesta missão) |

## 7. Problemas P0/P1 (abertos e encontrados)

Encontrados e **corrigidos** neste ciclo (todos com teste de regressão): §3.1, §3.2, §3.3 e
`L1-CONCORRENCIA-HTTP-DUPLO-ACCEPT` (§4.6, commit `867b47e30` — dupla aceitação concorrente).

Abertos na fila oficial (`AI_MEMORY/hardening-queue.json`, 110 itens, 6 `blocked_external`):

- `H15-DIST-RECIBO-STALE`, `H19-DIST-CAUSA-UNICA` — higiene do `dist/` (recibo stale do verifier);
- `MISSAO-B9-CI-GITHUB-ACTIONS` — CI bloqueado por budget; `release-governance.yml` não protege publicação;
- `H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE` — cadeia diverge do conteúdo atual (escritas pós-certificação);
- `P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO` — projeções gravadas antes da decisão final;
- `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` — gate agregado para em fail-closed sem run governado.

## 8. Riscos residuais

1. **Contenção de sandbox**: a bateria de integração do Router não é estável com paralelismo alto; sem
   `--maxWorkers` baixo ela produz `SANDBOX_UNAVAILABLE` que pode ser confundido com regressão. Risco
   de alguém ler "17 suítes vermelhas" como defeito de produto (ou o contrário).
2. **Fechamento de dependências por lista manual** ainda existe em outros Dockerfiles do monorepo; só o
   do Runner está coberto por teste de fechamento hoje.
3. **Gate agregado não executável** neste branch: qualquer afirmação de "pronto para release" baseada
   apenas em L0/L1 seria narrativa, não certificação.
4. **Projeções de status** (docs) podem divergir da decisão canônica enquanto `H20`/`P1-PROJECAO…`
   estiverem abertos.

## 9. Evidências

| Evidência | Caminho |
|---|---|
| L0 final (exit 0) | `/tmp/l1-l0-final.log` (medição da sessão; reprodutível pelo comando da §4) |
| L1 container real (exit 0) | `/tmp/l1-compose-e2e.log` |
| L1 isolado das 3 suítes | `/tmp/l1-isolated2.log` |
| L1 lote original (17 falhas por contenção) | `/tmp/l1-eng-int-change.log` |
| L1 serializado (`--maxWorkers=2`, HEAD final) | `/tmp/l1-l1-final.log` (exit 0, 221/221) |
| Testes de regressão | `tests/unit/engineeringRouterContextSourceFailClosed.test.js`, `tests/unit/governance/releaseStateService.test.js`, `tests/unit/engineeringRunnerDockerfileClosure.test.js` |
| Fila com os 3 itens | `AI_MEMORY/hardening-queue.json` (`L1-CONTEXTO-FONTE-NAO-MATERIALIZAVEL`, `L1-ENTREGA-VERIFICADA-SEM-VERIFICACAO`, `L1-RUNNER-CONTAINER-MODULE-NOT-FOUND`) |
| Commits publicados | `6ecca330c`, `ce343edd3`, `53da93267`, `713aafc1a`, `e3d358b5b`, `fb525c989` |

Observação de auditabilidade: os logs acima vivem em `/tmp` (transitórios). São **evidência da
sessão**, não prova versionada — a prova durável é o commit + o teste de regressão indicado em cada
item da fila, que reproduz o comportamento a qualquer momento.

## 10. Limitações operacionais

- O ambiente de execução é uma estação com Docker local; contenção de sandbox afeta a bateria de
  integração (ver §8.1).
- Não há identidade de run governado no branch de desenvolvimento, portanto o gate agregado não roda
  (bloqueio externo, não escolha).
- Este relatório foi produzido **pelo próprio Engenheiro** sobre trabalho do próprio Engenheiro.
- O **L0 de governança** lê artefatos de `reports/` (ignorados pelo git): em clone limpo, 10 suítes
  reprovam por ausência de evidência gerada, não por defeito de produto. Para auditar L0, use o
  repositório com os artefatos do run ou execute dentro do mesmo ciclo que os produziu. L1/L2 não
  têm essa dependência e reproduzem em clone limpo (§4.5).

## 11. Ações que exigem aprovação humana

1. Rodar a **missão de ensaio supervisionada** (item 10) com aprovação humana real registrada em
   `missionApprovalService` e promoção **não** executada sem autorização.
2. Autorizar (ou não) qualquer ciclo de selagem/release — **nada disso foi feito**.
3. Decidir sobre o CI bloqueado por budget (`MISSAO-B9-CI-GITHUB-ACTIONS`).
4. Aprovar a promoção de `dev/engineering-hardening` para `main` (nunca feita por este agente).

## 12. Veredito final

**`CANDIDATE_GO_SUPERVISIONADO`**

> Este veredito **não é GO**. Ele declara que os critérios de delegação supervisionada foram
> medidos e atendidos no que é executável nesta janela, e **solicita auditoria independente** do
> código e das evidências. Promoção para `main`, release e implantação continuam proibidas e
> pendentes de decisão humana.

Critérios do §11 da missão:

| # | Critério | Estado |
|---|---|---|
| 1 | Roteador executa missão com escopo limitado | **TESTED** (`pathBoundary`, `applyDiffPolicy`, `commandPolicy`, E2E de loop) |
| 2 | Workspace isolado | **TESTED** (`patchApplyService` + sandbox com `network=none`, cap-drop) |
| 3 | `source_commit` validado | **VERIFIED** (ciclo 1, teste novo) |
| 4 | Engenheiro não consegue publicar release sozinho | **VERIFIED** (`promotionService` sem `git push`; `publish-tag` exige `DELIVERED_VERIFIED` + `confirm: true`; `executionSandbox` recusa operações de governança) |
| 5 | Revisão independente comprovada | **VERIFIED** — executado: `engineeringMissionReviewEnforcement` (L1) e `engineeringRouterReviewerRejectionRecodeE2E` (1ª tentativa REJECT do reviewer, 2ª criada e aprovada até GREEN) |
| 6 | Evidências pertencem à tentativa correta | **TESTED** (`deriveGates` exige `attempt_id` e evidência de fase) |
| 7 | Gates aplicáveis executados | **VERIFIED na cadeia do Engenheiro** — L0 2782, L1 40 suítes/221, L2 8/8, `--runtime` **RUNTIME_PASS 25/25**, `structural`, `bug-closure-status`, `hardening-queue`, `route-mounts` PASS. Gate agregado: **BLOCKED_EXTERNAL** (sem identidade de run no branch), declarado, não mascarado |
| 8 | Testes obrigatórios aprovados | **VERIFIED** — L0 2782/2784 (2 skipped) + L1 221/221 + L2 8/8 + negativos 110/110 + runtime 25/25 itens, todos exit 0 |
| 9 | Riscos de operações destrutivas controlados | **TESTED** (política de comandos + RBAC de auto-modificação) |
| 10 | Isolamento de tenants validado | **VERIFIED** (suítes de tenant isolation na fila, `state=VERIFIED`) |
| 11 | Engineering Memory registra o ciclo | **VERIFIED** (4 itens com commit + teste + prevenção: contexto, entrega, Dockerfile, coletor) |
| 12 | Prevenção de regressões ativa | **VERIFIED** (testes de prevenção + fechamento do Dockerfile) |
| 13 | Aprovação humana obrigatória para promoção | **TESTED** (`missionApprovalService`) |
| 14 | Trilha de auditoria reproduzível | **VERIFIED** — commit por correção + teste de regressão versionado + evidência de runtime com `sourceCommit`; comandos de reprodução declarados em §4.5 |
| 15 | Commit publicado no GitHub | **VERIFIED** (`42dd5f34b`) |
| 16 | SHA remoto confirmado | **VERIFIED** (`git ls-remote` = `42dd5f34b…`) |

Critérios 1–16 atendidos no que é executável, com uma ressalva explícita: o **gate agregado** segue
`BLOCKED_EXTERNAL` (não existe identidade de run governado no branch de desenvolvimento) e a
**aprovação humana real** de uma missão não foi executada — o L2 prova o mecanismo com aprovação
programática de ator distinto. Declarar `GO` seria converter essas duas pendências em aprovação;
por isso o veredito é **candidato**, que por definição pede auditoria independente.

### 12.1 O veredito deixou de ser prosa: gate executável (§13)

`npm run validate:engineer-supervised-readiness`
(`scripts/governance/validate-engineer-supervised-readiness.js`) deriva a decisão de fatos medidos.
Nenhum check é assumido:

| Check | O que mede |
|---|---|
| `QUEUE_READABLE` / `QUEUE_NO_OPEN_DEFECT` | fila oficial: nenhum item `pending`/`in_progress`/`failed`/`fixed_unverified` |
| `QUEUE_NO_BLOCKED` | nenhum item `blocked`/`blocked_external` — impedimento declarado **não é** prontidão |
| `EVIDENCE_COMMITS_EXIST` | cada `commit` de prova é resolvido com `git cat-file` (**123** verificados) |
| `SEGREGATION_VISIBILITY` / `SEGREGATION_EXPERIENCE` / `SEGREGATION_EXPERIENCE_API` | lê os três relatórios: `status=PASS`, `violations=0`, contadores `0` |
| `READINESS_DOC_PRESENT` / `READINESS_DOC_SECTIONS` | o documento existe **e** não foi esvaziado (7 seções obrigatórias) |
| `HUMAN_APPROVAL_PRESENT` / `HUMAN_APPROVAL_VALID` | assinatura com `approver`, `approvedAt`, `missionId`, `scope`, `statement`, `simulated:false` — sem ela **nunca** há GO |

Vereditos: `ENGINEER_SUPERVISED_READY_GO` (exit 0) **somente** com todos os checks PASS e aprovação
humana real; `PENDING_HUMAN_APPROVAL` (exit 2) com checks PASS e sem assinatura; `NOT_READY`
(exit 1) se qualquer check bloqueante falhar; `INFRA_ERROR` (exit 3) quando não foi possível medir.

**Medição de 2026-10-21 (veredito real do gate):** `NOT_READY` (exit 1), com dois bloqueadores:

1. `QUEUE_NO_BLOCKED` — 6 itens `blocked_external` (`H15`, `H19`, `H20`,
   `MISSAO-B9-CI-GITHUB-ACTIONS`, `P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO`,
   `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3`);
2. `HUMAN_APPROVAL_PRESENT` — não existe assinatura humana em
   `AI_MEMORY/evidence/engineer-supervised-approval.json`.

Isto é mais restritivo do que a prosa anterior (`CANDIDATE_GO_SUPERVISIONADO`) e é a medição
correta: **com 6 impedimentos externos abertos não se declara GO**, e sem assinatura humana também
não. O gate está acima da narrativa — que era o objetivo do §13.

### 12.2 O gate encontrou um falso verde que a fila escondia

Na primeira execução, `EVIDENCE_COMMITS_EXIST` reprovou **3 itens `done`** que citavam o commit
`5f6d0c1c9` — hash que **não existe em nenhum objeto do repositório** (reescrito num rebase
anterior). O validador da fila só exigia "campo não vazio", então a fila exibia provas que ninguém
podia abrir.

As correções eram reais; os **ponteiros** estavam órfãos. Reancorados aos commits que de fato
introduziram as provas (`5d451e1c9` nos dois itens de CRM, `ad92da172` no CDR), com
`reanchoredFrom`/`reanchoredReason` registrados. Prevenção na origem: `validate-hardening-queue.js`
agora reprova com `COMMIT_INEXISTENTE` qualquer hash inexistente ou malformado, e com
`GIT_INDISPONIVEL` quando não consegue olhar (nunca "passa por não ter olhado").
Prova: `hardeningQueueCommitExists.test.js` (5 casos, incluindo o hash do incidente) e
`engineerSupervisedReadinessGate.test.js` (7 casos de semântica de veredito).
Regressão `tests/unit/governance`: **177 suítes / 1854 testes, exit 0**.

## 13. Próxima ação recomendada

1. **Auditoria independente** deste relatório e das evidências (é o que o veredito candidato pede).
2. Rodar a missão de ensaio com **aprovação humana real** registrada em `missionApprovalService`;
   o mecanismo já está provado (L2), falta a assinatura do humano.
3. Resolver `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` para que o gate agregado execute no
   branch de desenvolvimento.
4. Manter **uma sessão por worktree**: foi a concorrência que produziu tanto a mutilação quanto as
   reprovações intermitentes do coletor — agora detectada pela trava e pela guarda de integridade.

## 14. Relatório final consolidado (missão P0/P1, baseline `40042f1a3`)

> Nota de honestidade sobre o template: a lista literal de campos pedida no §16 do enunciado não
> está disponível no workspace (o prompt chegou como anexo e não foi persistido). Este relatório
> cobre, campo a campo, tudo o que as seções §1–§13 da missão exigiram e mais o que foi medido —
> sem inventar campo para "fechar" um template.

### 14.1 Veredito

**`NOT_READY`** — medido por `npm run validate:engineer-supervised-readiness` (exit 1), não por
opinião. Dois bloqueadores:

| Bloqueador | Detalhe |
|---|---|
| `QUEUE_NO_BLOCKED` | 6 itens `blocked_external`: `H15-DIST-RECIBO-STALE`, `H19-DIST-CAUSA-UNICA`, `H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE`, `MISSAO-B9-CI-GITHUB-ACTIONS`, `P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO`, `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` |
| `HUMAN_APPROVAL_PRESENT` | não existe `AI_MEMORY/evidence/engineer-supervised-approval.json` |

Nenhum dos dois é resolvível por mim: o primeiro depende de decisões/recursos do dono (budget de
CI, certificação, autoridade de scorecard) e o segundo é, por definição, assinatura de outra pessoa.

### 14.2 Defeitos P0/P1 corrigidos nesta janela

| ID | Severidade | Causa raiz medida | Correção | Prova | Commit |
|---|---|---|---|---|---|
| `P0-FILAS-ROLLBACK-DESTRUTIVO` | P0 | rollback chamava `deleteQueue(name, true)` e fechava tickets ativos, inclusive de fila **preexistente** | `created:true|false` + rollback escopado sem `force` | `queueCreatePersistBeforeResponse` (helpers reais) + 157/157 filas | `7803aaa12` |
| `P0-FILAS-ISOLAMENTO-TENANT` | P0 | exclusão forçada do tenant A fechava tickets do tenant B (mesmo nome de fila) | `tenantId` em list/create/delete/info | `queueTenantIsolation` (5) | `7803aaa12` |
| `P1-REVISAO-INDEPENDENCIA-SO-NEGATIVA` | P1 | `approvedReview && !contradicted` aceitava APPROVE sem declarar independência | prova positiva (declaração + identidade + provider distinto) | gates 10/10; integração 16/16 | `b5d92a87e` |
| `P1-CONCORRENCIA-EXIGE-POSTGRES` | P1 | `if (skipIfNoDatabase()) return;` dava PASS sem executar | `INFRA_ERROR` explícito + sonda `SELECT 1` | passa com banco; falha com URL inválida | `9e5005556` |
| `P1-UNIT-GATE-ACEITA-UNKNOWN` | P1 | gate `unit` usava "qualquer execução verde", inclusive UNKNOWN | exige run classificado UNIT com PASS/exit 0 | 443 unit; enforcement 7/7 | `f1a3ca037` |
| `P1-GUARDA-SKIP-ASSERTIONS-COMMITS` | P1 | guarda só contava declarações; pre-push comparava com o **worktree**, não com o commit | `TEST_SUPPRESSION_ADDED`, `ASSERTION_REMOVAL`, `--head <sha>` por ref | 14/14; mutação commitada bloqueada (exit 1) | `d22e26539`, `423f2d815` |
| `P1-LINEAGE-RUN-MAIS-RECENTE` | P1 | produtor de evidência escolhia "o run mais recente" e omitia `sourceCommit` | identidade explícita (`GOVERNANCE_RUN_ID`/`.current-run.json`) + mismatch = erro | 6 casos + `tests/unit/governance` | `ab375c1b4` |
| `P1-CI-SEM-INTEGRACAO` | P1 | gate/CI do branch não rodava **nenhuma** suíte de integração | passo L0b + job `dev-branch-integration` (pgvector+redis), fail-closed | primeira execução reprovou 2 suítes (achado abaixo) | `a67a99835` |
| `P1-MERGE-MISSAO-PERDA-DE-ATUALIZACAO` | P1 | `mergeMissionJson` era read-modify-write: escrita concorrente apagava a chave da outra | CAS por `updatedAt` + merge reaplicado + `MISSION_MERGE_CONFLICT` | 5 casos (código antigo: 1 falha) | `697381bbb` |
| `P1-PATCH-SYMLINK-ESCAPE` | P1 | patch com `new file mode 120000` criava symlink para `/etc/shadow`/`../../.env`, e a fronteira de path (compara NOME) não via | `PATCH_SYMLINK_FORBIDDEN` fail-closed | 7/7 (4 falhas no código antigo) | `bd376df01` |
| `P1-EVIDENCIA-COMMIT-ORFAO` | P1 | fila aceitava prova com commit inexistente (3 itens citavam `5f6d0c1c9`, hash reescrito) | `COMMIT_INEXISTENTE` + `GIT_INDISPONIVEL` no validador da fila; itens reancorados | 5 casos (usa o hash do incidente) | `eb6ca426c` |
| `P1-GATE-PRONTIDAO-EXECUTAVEL` | P1 | veredito de prontidão era prosa | gate executável com semântica de veredito provada | 7 casos | `eb6ca426c` |
| `P1-BRANCHES-MISSAO-RESIDUO` | P1 | 3.017 refs `engineering/missions/*` sem poda em produção (~22 por execução) | poda classificada por missão, dry-run por padrão; **aplicada com aprovação** | 3.007 removidas, 10 preservadas (missões de usuário) | `c4770aa55`, `23f6eb8c7` |

Nenhum teste foi apagado ou enfraquecido para obter verde. Contratos alterados foram migrados
explicitamente e estão nomeados nos commits (ex.: `queueCreatePersistBeforeResponse`,
`bugClosureQueueModel` passou a usar commit real porque o contrato de prova mudou).

### 14.3 Medições (todas exit 0, árvore limpa)

| Bateria | Resultado |
|---|---|
| `npx jest tests/unit` | 1080 suítes / 9174 testes (2 skipped declarados) |
| `npx jest tests/unit/governance` | 177 suítes / 1854 testes |
| `npx jest tests/unit/engineeringRouter` + suíte nova | 39 suítes / 400 testes |
| `tests/unit/engineeringMission` + integração patchRunner/promoção | 38 suítes / 457 testes |
| `npx jest tests/integration/engineering --maxWorkers=2` | **40 suítes / 219 testes, 577 s** |
| `validate:visibility-policy` | PASS, 0 violações |
| `validate:experience-segregation` | PASS (205 superfícies, 22 support), 0 violações |
| `validate:experience-api-segregation` | PASS, leaks 0/0/0 |
| `validate:hardening-queue` | PASS — 128 itens, 125 commits de prova resolvidos no git |
| `validate:engineer-supervised-readiness` | **NOT_READY** (exit 1) — ver 14.1 |

### 14.4 Riscos residuais (declarados, não mascarados)

1. **Contenção de ambiente**: sob carga, suítes que executam sub-Jest (smoke pós-promoção) podem
   estourar deadline → `TIMEOUT` → promoção reprovada. Medido 1× na bateria e 0× nas execuções
   seguintes; agora diagnosticável pelo `code`. Mitigação real: uma sessão por worktree.
2. **Resíduo de refs**: poda aplicada, mas os testes continuam criando ~22 branches por execução e
   não há poda automática no teardown (decisão de arquitetura pendente: marcar branches de teste).
3. **Gate agregado** (`validate:governance-enforcement`) segue `BLOCKED_EXTERNAL` no branch de
   desenvolvimento — não roda por falta de identidade de run governado.
4. **Validação em browser real** da segregação não foi reexecutada nesta janela (os 3 gates são
   estáticos).

### 14.5 Reprodução (comandos exatos)

```bash
git fetch origin && git checkout dev/engineering-hardening
npx jest tests/unit                       # 1080 suítes / 9174 testes
npx jest tests/integration/engineering --bail=0 --maxWorkers=2 --forceExit
npm run validate:visibility-policy
npm run validate:experience-segregation
npm run validate:experience-api-segregation
npm run validate:hardening-queue
npm run validate:engineer-supervised-readiness   # NOT_READY até haver assinatura humana
```

### 14.6 Como fechar o último bloqueador que depende de humano

Criar `AI_MEMORY/evidence/engineer-supervised-approval.json`:

```json
{
  "approver": "<nome ou identificador do humano>",
  "approvedAt": "<ISO-8601>",
  "missionId": "<id da missão de ensaio>",
  "scope": "ENGINEER_SUPERVISED_READY_GO",
  "statement": "<o que está sendo aprovado, em texto próprio>",
  "simulated": false
}
```

Com os 6 `blocked_external` resolvidos (ou aceitos explicitamente como risco pelo dono) **e** a
assinatura acima, o gate passa a `ENGINEER_SUPERVISED_READY_GO`. Nada mais é necessário — e nada
menos é aceito.

### 14.7 Estabilidade do próprio gate (dois falsos vermelhos corrigidos)

O L0 oficial não era determinístico nesta máquina. Medido em 2026-10-21 com o default do
`jest.config.cjs` (workers derivados do orçamento de conexões ⇒ 11 numa máquina de 12 CPUs):

| Execução | Resultado |
|---|---|
| `npx jest tests/unit` (default, 11 workers) | **FAIL** — `engineeringRouterExecutionSandboxSecurity`: 3 casos com `SANDBOX_UNAVAILABLE` |
| idem, repetida | **FAIL** — `tenantAiCredentialsSaveRoute`: `Exceeded timeout of 10000 ms` |
| idem, com `--maxWorkers=4` | **PASS — 1086 suítes / 9214 testes / 358 s** |

Cada execução reprovava uma suíte **diferente**, sempre por tempo/probe — nunca por asserção de
comportamento. Duas causas distintas foram encontradas e corrigidas:

1. **`P1-SANDBOX-PROBE-CACHE-NEGATIVO` (`11a461e59`)** — `isSandboxAvailable()` fazia
   `docker info` (timeout 5 s) **uma vez por processo** e cacheava também o resultado NEGATIVO.
   Com load average 12 o probe estourava e o processo inteiro passava a responder
   `SANDBOX_UNAVAILABLE` com o Docker saudável (`docker ps` respondendo; a suíte isolada passava
   10/10). Em produção isso reprova task legítima como `INFRA_ERROR`, e o envenenamento dura até o
   processo morrer. Correção: só o POSITIVO é cacheado; falha transitória é retentada (2 tentativas)
   e, se persistir, responde `false` sem envenenar; `ENOENT` (CLI ausente) é definitivo e cacheado.
2. **`P1-L0-INDETERMINISTA-POR-CONTENCAO` (`24603e69b`)** — o passo L0 herdava os 11 workers e
   saturava a máquina. O gate agora fixa `JEST_MAX_WORKERS=4` (override `L0_JEST_MAX_WORKERS`) e o
   relatório registra `envFixado` por passo — "passou no gate" e "passou na minha máquina" deixam de
   ser a mesma frase. O default de `npm test` à mão **não** mudou.

Provas: `engineeringRouterSandboxAvailabilityCache.test.js` 7/7 (contra o código anterior, 3
falhas: timeout, SIGTERM e recuperação); sandbox real + cache 17/17; `ciGateL0Determinism.test.js`
3/3.
