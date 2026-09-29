# Ciclo Autônomo de Bug (AI_MEMORY)

Doc canônica: `docs/architecture/BUG_AUTONOMOUS_LOOP.md`.

## O que existe

- Motor puro: `engine/engineeringMission/bugFinding/` (constants, fingerprint, classification,
  lifecycle, reproductionPlan, selfModification, anomalyDetection, routing).
- Persistência: tabelas `engineering_bug_findings` (estado) e `engineering_bug_finding_events`
  (histórico append-only), migration `20260929120000-create-engineering-bug-findings.js`.
- Serviços: `api/services/engineeringMission/bugFindingService.js`,
  `bugReproductionService.js`, `bugTriageService.js`, `bugLoopCoordinatorService.js`.
- Rotas DEVELOPMENT: `GET/POST /engineering/findings*`, `POST /engineering/findings/:id/{reproduce,
  confirm,triage,fix,evidence,approve-self-modification}`, `POST /engineering/findings/sweep`,
  `POST /engineering/findings/telemetry` (RBAC por ação, fail-closed).
- Gate: `npm run validate:bug-autonomous-loop` → `reports/bug-autonomous-loop-report.json`.
  Passo `BUG_AUTONOMOUS_LOOP` no selo V2 e item de runtime no `validate-engineering-router-v2`.

## Regras que nunca podem ser afrouxadas

- Confirmar exige BASE OBJETIVA + evidência persistida. `LLM_SUSPICION`/`HEURISTIC`/`TIMEOUT_ONLY`
  nunca confirmam; TIMEOUT na reprodução é `INCONCLUSIVE` e devolve o finding para `SUSPECTED`.
- `FIXED` = reprodução verde + testes direcionados verdes + parecer aprovado. Patch aplicado ≠ fix.
- `REGRESSION_VALIDATED` = execuções de regressão reais (nunca teste verde isolado).
- Fechar exige reprodução + evidência + regressão registradas (greenwashing é bloqueado).
- Self-modification (governança/router/policy/lease/release/anti-greenwashing) exige aprovação
  humana; `auto_approval_forbidden` por default e imune a policy para HIGH/CRITICAL.
- INFRA/PROVIDER/CONFIGURATION não geram patch de aplicação.

## Fatos medidos (2026-09-29)

- `RELEASE_AUTHORITATIVE=1 npm run engineering-router:v2-seal` → **GO, 17/17 passos PASS**, incluindo
  `BUG_AUTONOMOUS_LOOP`. Verdicts: `BUG_DETECTION`, `BUG_TRIAGE`, `BUG_REPRODUCTION`,
  `BUG_CONFIRMATION`, `BUG_TASK_GENERATION`, `AUTONOMOUS_FIX_LOOP`, `REGRESSION_VALIDATION`,
  `MISSION_CONTINUATION`, `SELF_MODIFICATION_GUARD`, `BUG_AUTONOMOUS_LOOP` = **GREEN** (20/20 itens,
  runtime PROVEN; 48 suítes na execução autoritativa).
- E2E real (Router + sandbox Docker + fixture `tests/fixtures/engineering-router-sandbox/mathUtils.js`
  RED por design): ~45-57 s, finding CLOSED, missão original intacta e ainda resumível.
- `npx jest tests/unit/engineeringBugFindingEngine.test.js` = 41 testes; integração = 17; E2E = 3.
- O patch do fix NUNCA toca o working tree: a promoção acontece em branch de candidato (o E2E remove a
  branch no teardown) — verificado por asserção no próprio E2E.
- Suítes autoritativas NÃO podem usar `console.warn('PULADO...') + return`: o passo
  `ANTI_GREENWASHING` do selo reprova (`SILENT_INFRA_SKIP_NOT_MIGRATED`). Use
  `tests/helpers/infraGate.js#skipOrFail` (registra `NOT_EXECUTED` em dev e lança `INFRA_ERROR` em
  `RELEASE_AUTHORITATIVE=1`).
- Superfície do ciclo coberta por execução real: 13 rotas `VALIDATED` na `wave:api-surface` e a
  página `/dev/engineering/findings` `VALIDATED` (auth + classification + pageLoads) na
  `wave:page-surface`; `validate:coverage-gate` = **GO** (critical 0/0/0/0, visibility 0).
- Finding originado por missão de VERIFICAÇÃO (`created_by` = `verify-*`/`jest`/`test`/`e2e`) nasce
  com `triage.provenance=VERIFICATION`: continua registrado e auditável, mas a varredura do laço não
  o transforma em item de correção (não se "conserta" missão de prova). Detecção não é enfraquecida.
- Página nova do frontend DEVE ter export NOMEADO (`export function XPage()`): `lazyPage` resolve
  `module[exportName]` — `export default` faz a página quebrar no carregamento (defeito real pego
  pela `wave:page-surface`).

## Armadilhas

- `self_modification` não pode ser disparado só pelo subsistema onde o sintoma aparece: subsistema
  sensível conta apenas quando NÃO há caminhos declarados (senão todo bug do subsistema de missão
  ficaria bloqueado esperando humana). Categoria só dispara para `GOVERNANCE`.
- `runTask` que devolve vazio é tratado como `UNKNOWN` (nunca GREEN) — não confie em retorno de
  provider/serviço sem checar `status`.
- O gate lê `reports/release-suite-execution.json`: suíte fora do manifesto autoritativo, ausente ou
  com `.skip`/`.only`/`xit` derruba o veredito. As três suítes do ciclo entraram em
  `config/canonical-release-suites.json#discovery.explicit` — deliberadamente NÃO por glob.
