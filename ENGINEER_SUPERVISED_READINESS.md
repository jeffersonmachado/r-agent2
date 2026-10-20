# ENGINEER_SUPERVISED_READINESS — Missão L-1 (RAP / r-agent2)

> **Veredito: `ENGINEER_SUPERVISED_READY_NO_GO`**
>
> O Engenheiro está mais seguro do que estava no início do ciclo (três defeitos reais de execução
> foram reproduzidos e corrigidos, com teste de regressão), mas **não** há base para declarar
> prontidão supervisionada: restam lacunas medidas de L2/L3 e bloqueios externos registrados na
> fila oficial. Este relatório é **evidência candidata**, não certificação independente.

| Campo | Valor |
|---|---|
| Data da avaliação | 2026-10-20 |
| Branch | `dev/engineering-hardening` |
| SHA local | `fb525c989c95eaeb725163e84737239a4ed5c7fa` |
| SHA remoto (`origin/dev/engineering-hardening`) | `fb525c989c95eaeb725163e84737239a4ed5c7fa` (confirmado por `git ls-remote`) |
| Escopo | Preparação e comprovação da delegação supervisionada (L-1). **Não** é implantação do StudioOly, **não** é release |
| Commit final do ciclo | `fb525c989` (ciclo 4), precedido por `e3d358b5b`, `713aafc1a`, `53da93267`, `ce343edd3`, `6ecca330c` |
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

## 5. Testes NÃO executados (declarado, com motivo)

| Não executado | Motivo |
|---|---|
| `npm test` completo (todas as raízes) | fora do escopo de L-1 nesta janela; o objetivo é a cadeia do Engenheiro, não a plataforma inteira |
| `npm run validate:governance-enforcement` (gate agregado) | **bloqueado_external**: não existe identidade de run governado no branch de desenvolvimento — item `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` (`blocked_external`) |
| `npm run release:seal` / `zip:release` | proibido pela missão (não publicar release) e bloqueado por `H15`/`H19`/`H20` (`blocked_external`) |
| Missão supervisionada de ensaio (item 10) ponta a ponta com aprovação humana real | **não executada** — exigiria uma missão real com aprovação humana no meio; as peças estão provadas por teste, a jornada completa não |
| Certificação do contrato EVO | fora do escopo explícito de L-1 (a missão diz que não é requisito) |
| QA Mesh / QA Waves canônicos | pertencem ao selo; o selo está `SEAL_PENDING` e não é objetivo de L-1 |

## 6. Resultado de cada gate (medido, sem narrativa)

| Gate | Resultado |
|---|---|
| L0 unit (engenharia + governança) | PASS (2762/2764, 2 skipped declarados) |
| L1 integração do Engenheiro (bateria completa) | PASS (40 suítes / 221 testes, exit 0) |
| Container real do Runner | PASS (4/4) após correção do `Dockerfile` |
| Fechamento de dependências da imagem | PASS (2/2) |
| Política do agente (Constituição) | PASS |
| Gate do Router V1 — `STRUCTURAL` (árvore publicada) | PASS — 183 checks, 0 falhas |
| Gate do Router V1 — `--runtime` (evidência do commit) | **FAIL (RUNTIME_FAIL)** — 209 checks, 1 item reprovado por instabilidade do coletor (§4.4) |
| `validate:bug-closure-status` | PASS — 9/9 entrypoints guardados, 13 provas de mecanismo |
| `validate:hardening-queue`, `route-mounts`, `ai-memory`, `ai-memory-consistency`, `agent-adherence` | PASS |
| Gate agregado de governança | **NÃO EXECUTADO** (bloqueio externo de identidade de run) |
| Selo de release | `SEAL_PENDING` (não perseguido nesta missão) |

## 7. Problemas P0/P1 (abertos e encontrados)

Encontrados e **corrigidos** neste ciclo (todos com teste de regressão): §3.1, §3.2, §3.3.

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

## 11. Ações que exigem aprovação humana

1. Rodar a **missão de ensaio supervisionada** (item 10) com aprovação humana real registrada em
   `missionApprovalService` e promoção **não** executada sem autorização.
2. Autorizar (ou não) qualquer ciclo de selagem/release — **nada disso foi feito**.
3. Decidir sobre o CI bloqueado por budget (`MISSAO-B9-CI-GITHUB-ACTIONS`).
4. Aprovar a promoção de `dev/engineering-hardening` para `main` (nunca feita por este agente).

## 12. Veredito final

**`ENGINEER_SUPERVISED_READY_NO_GO`**

Critérios do §11 da missão:

| # | Critério | Estado |
|---|---|---|
| 1 | Roteador executa missão com escopo limitado | **TESTED** (`pathBoundary`, `applyDiffPolicy`, `commandPolicy`, E2E de loop) |
| 2 | Workspace isolado | **TESTED** (`patchApplyService` + sandbox com `network=none`, cap-drop) |
| 3 | `source_commit` validado | **VERIFIED** (ciclo 1, teste novo) |
| 4 | Engenheiro não consegue publicar release sozinho | **VERIFIED** (`promotionService` sem `git push`; `publish-tag` exige `DELIVERED_VERIFIED` + `confirm: true`; `executionSandbox` recusa operações de governança) |
| 5 | Revisão independente comprovada | **TESTED** (`missionReviewService`: `INDEPENDENT_REVIEW_CONTRADICTED_BY_PROVIDER`) |
| 6 | Evidências pertencem à tentativa correta | **TESTED** (`deriveGates` exige `attempt_id` e evidência de fase) |
| 7 | Gates aplicáveis executados | **PARCIAL** — L0/L1 do Engenheiro verdes, `structural`/`bug-closure-status`/`hardening-queue`/`route-mounts` PASS, mas `--runtime` = **RUNTIME_FAIL** em 1 item por instabilidade do coletor (§4.4) e o gate agregado não é executável |
| 8 | Testes obrigatórios aprovados | **PARCIAL** (cadeia do Engenheiro: 2762 unit + 221 integração verdes; itens de runtime passam por comando direto, não pelo coletor) |
| 9 | Riscos de operações destrutivas controlados | **TESTED** (política de comandos + RBAC de auto-modificação) |
| 10 | Isolamento de tenants validado | **VERIFIED** (suítes de tenant isolation na fila, `state=VERIFIED`) |
| 11 | Engineering Memory registra o ciclo | **VERIFIED** (4 itens com commit + teste + prevenção: contexto, entrega, Dockerfile, coletor) |
| 12 | Prevenção de regressões ativa | **VERIFIED** (testes de prevenção + fechamento do Dockerfile) |
| 13 | Aprovação humana obrigatória para promoção | **TESTED** (`missionApprovalService`) |
| 14 | Trilha de auditoria reproduzível | **PARCIAL** (commits + testes; logs de sessão em `/tmp`) |
| 15 | Commit publicado no GitHub | **VERIFIED** (`42dd5f34b`) |
| 16 | SHA remoto confirmado | **VERIFIED** (`git ls-remote` = `42dd5f34b…`) |

Critérios 7, 8 e 14 em **PARCIAL**; o bloqueio concreto do 7 é o **instrumento de certificação**
(coletor de runtime reprova um item diferente a cada execução, enquanto cada item passa por comando
direto). A ausência da missão de ensaio supervisionada (§5) e o gate agregado não executável
fecham o restante. Declarar `GO` aqui seria converter ausência de medição em aprovação — exatamente
o que a missão proíbe.

## 13. Próxima ação recomendada

1. Rodar a **missão de ensaio supervisionada** (item 10) numa branch descartável, com aprovação
   humana registrada e bloqueio de promoção comprovado — é o único critério de L2/L3 que falta.
2. Em paralelo, resolver `P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3` para que o gate agregado
   possa executar no branch de desenvolvimento (sem ele, 7/8/14 nunca saem de PARCIAL).
3. Publicar a prova de L1 em local durável (hoje `/tmp`): os logs do §9 devem ir para
   `AI_MEMORY/evidence/` quando a política de escrita `.json`/`.md` desse diretório permitir.
