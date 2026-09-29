# Ciclo Autônomo de Bug (Bug Autonomous Loop)

**Status:** implementado e provado em runtime (2026-09-29) — veredito `BUG_AUTONOMOUS_LOOP` derivado
por `npm run validate:bug-autonomous-loop`.

## Problema que este ciclo elimina

O ciclo antigo dependia de uma pessoa:

```
BUG → Jefferson percebe → gera ZIP → envia para auditoria → recebe prompt → manda para outro modelo
```

O ciclo novo é interno:

```
BUG → RAP detecta → FINDING → reproduz → confirma → cria ENGINEERING TASK →
      ROUTER corrige → testa → revisa → regression → volta à MISSÃO ORIGINAL
```

Nada disso exige ZIP novo, prompt novo ou missão nova: um bug descoberto **durante** uma Engineering
Mission passa a ser trabalho interno dela.

## Arquitetura reutilizada (nada de subsistema paralelo)

| Peça existente | Uso pelo ciclo de bug |
|---|---|
| `EngineeringTask` + `engineeringTaskService` | o fix É uma task normal do Router (lease, fence, CAS, state machine) |
| `engineeringRouterService.runTask` | executa a correção: classifier, policy, seleção de modelo, path boundary, patch validator, worktree, sandbox, reviewer, regression plan, governance gate |
| `EngineeringAttempt/TestRun/Review/RegressionRun/TelemetryEvent` | **evidência real** consultada para declarar FIXED e REGRESSION_VALIDATED |
| `testRunnerService` + `executionSandbox` | reprodução e testes executados no MESMO sandbox Docker do Router |
| `patchApplyService.createWorkspace` | workspace git isolado (nunca o working tree principal) |
| `EngineeringMission` + `missionOrchestratorService` | a missão original continua a mesma; `continueMission` reconcilia e devolve o ponto de retorno |
| `engineering_missions` (rotas/DEVELOPMENT + RBAC) | superfície HTTP do ciclo, com classificação PRODUCTION/SUPPORT intacta |
| Modelos de review (Meta/Adversarial) | findings de review continuam alimentando o ciclo (sources `META_REVIEW`/`ADVERSARIAL_REVIEW`) |

## Peças novas (mínimas e justificadas)

1. `engine/engineeringMission/bugFinding/` — motor **puro** com as regras:
   - `constants.js` — status, transições, fontes, categorias, bases de confirmação, prefixos de
     self-modification;
   - `fingerprint.js` — identidade estável da falha (ignora timestamp/id/linha) → impede 200 bugs
     iguais;
   - `classification.js` — categoria, severidade (sinais objetivos; sugestão de LLM é só advisory) e
     elegibilidade de confirmação;
   - `lifecycle.js` — máquina de estados + FIXED/REGRESSION_VALIDATED + reincidência + detecção de
     greenwashing;
   - `reproductionPlan.js` — plano e avaliação da reprodução (REPRODUCED / NOT_REPRODUCED /
     INCONCLUSIVE);
   - `selfModification.js` — proteção de self-modification e baseline de regras;
   - `anomalyDetection.js` — padrões de telemetria → candidatos SUSPECTED;
   - `routing.js` — finding → capabilities/tipo de task/contrato (o Router continua escolhendo modelo).
2. `api/db/migrations/20260929120000-create-engineering-bug-findings.js` — `engineering_bug_findings`
   (estado) + `engineering_bug_finding_events` (histórico **append-only**), com FK `RESTRICT`.
3. `api/services/engineeringMission/bugFindingService.js` — registro, deduplicação, evidência,
   transições e ciclo de vida.
4. `api/services/engineeringMission/bugReproductionService.js` — reprodução real em workspace isolado.
5. `api/services/engineeringMission/bugTriageService.js` — triagem, geração de task, guarda de
   self-modification e aprovação humana.
6. `api/services/engineeringMission/bugLoopCoordinatorService.js` — o loop: detecção, reprodução,
   confirmação, task, correção, provas do fix, regressão e retomada da missão.

## Regras que o ciclo NÃO permite violar

- **Suspeita de LLM não é bug.** `LLM_SUSPICION`, `HEURISTIC` e `TIMEOUT_ONLY` estão em
  `NON_CONFIRMATION_BASES`; um finding sem base objetiva permanece `SUSPECTED`.
- **TIMEOUT isolado não é bug.** A reprodução que estoura deadline é `INCONCLUSIVE`; o finding volta a
  `SUSPECTED` (informação preservada, veredito não inventado).
- **Patch não é fix.** `FIXED` exige reprodução verde + testes direcionados verdes + parecer aprovado.
- **Teste verde isolado não é regressão validada.** `REGRESSION_VALIDATED` exige execuções reais de
  regressão referenciadas.
- **Nenhum bug CONFIRMED desaparece.** Fechar exige reprodução/evidência/regressão registradas; o gate
  acusa `CLOSED_WITHOUT_REPRODUCTION`, `CLOSED_WITHOUT_EVIDENCE`, `REGRESSION_NOT_EXECUTED`,
  `FIX_WITHOUT_REGRESSION`.
- **Self-modification não se autoaprova.** Fix que toca governança/router/policy/lease/release exige
  aprovação humana explícita (`auto_approval_forbidden`), com baseline de regras capturado antes.
- **INFRA/PROVIDER/CONFIGURATION não viram patch de aplicação.**

## Fontes de detecção (modelo único)

Unit/integration/E2E/regression test, release gate, exceção, stack trace, HTTP/DB/provider error,
crash, timeout, NO_PROGRESS, invariante, security scan, Meta Reviewer, Adversarial Reviewer, análise
estática, telemetria, stale write, lease/fencing, inconsistência de governança e relato humano —
todas entram por `registerFinding`. Não existe integração por fonte.

## Verificação

- `npm run validate:bug-autonomous-loop` → `reports/bug-autonomous-loop-report.json`
  (`BUG_AUTONOMOUS_LOOP`, `BUG_DETECTION`, `BUG_TRIAGE`, `BUG_REPRODUCTION`, `BUG_CONFIRMATION`,
  `BUG_TASK_GENERATION`, `AUTONOMOUS_FIX_LOOP`, `REGRESSION_VALIDATION`, `MISSION_CONTINUATION`,
  `SELF_MODIFICATION_GUARD`).
- Os 20 testes obrigatórios estão declarados em `config/engineering-bug-loop-required-tests.json` e
  são derivados da execução autoritativa real (`reports/release-suite-execution.json`) — nunca de
  texto fixo.
- Suítes: `tests/unit/engineeringBugFindingEngine.test.js`,
  `tests/integration/engineeringBugLoop.test.js`,
  `tests/integration/engineeringBugAutonomousLoopE2E.test.js`.
- O passo `BUG_AUTONOMOUS_LOOP` faz parte do selo V2 (`npm run engineering-router:v2-seal`) e o
  veredito é exigido pelo `validate-engineering-router-v2.js`.
