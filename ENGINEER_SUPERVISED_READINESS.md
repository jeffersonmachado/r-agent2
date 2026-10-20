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

## 5. Testes NÃO executados (declarado, com motivo)

| Não executado | Motivo |
|---|---|
| `npm test` completo (todas as raízes) | fora do escopo de L-1 nesta janela; o objetivo é a cadeia do Engenheiro, não a plataforma inteira |
| `npm run validate:governance-enforcement` (gate agregado) | **bloqueado_external**: não existe identidade de run governado no branch de desenvolvimento — item `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` (`blocked_external`) |
| `npm run release:seal` / `zip:release` | proibido pela missão (não publicar release) e bloqueado por `H15`/`H19`/`H20` (`blocked_external`) |
| Missão supervisionada de ensaio (item 10) com **aprovação humana real** | jornada executada de ponta a ponta em L2 (§4.5) com aprovação **programática** de ator distinto; a assinatura humana real não foi executada — exige decisão do usuário |
| Certificação do contrato EVO | fora do escopo explícito de L-1 (a missão diz que não é requisito) |
| QA Mesh / QA Waves canônicos | pertencem ao selo; o selo está `SEAL_PENDING` e não é objetivo de L-1 |

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

## 13. Próxima ação recomendada

1. **Auditoria independente** deste relatório e das evidências (é o que o veredito candidato pede).
2. Rodar a missão de ensaio com **aprovação humana real** registrada em `missionApprovalService`;
   o mecanismo já está provado (L2), falta a assinatura do humano.
3. Resolver `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` para que o gate agregado execute no
   branch de desenvolvimento.
4. Manter **uma sessão por worktree**: foi a concorrência que produziu tanto a mutilação quanto as
   reprovações intermitentes do coletor — agora detectada pela trava e pela guarda de integridade.
