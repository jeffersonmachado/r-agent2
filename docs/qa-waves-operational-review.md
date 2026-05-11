# QA Waves Operational Review

Gerado em: 2026-05-07

## Visao Geral

QA Waves foi reforcado para deixar de aceitar sucesso operacional apenas por execucao sem erro, clique executado ou objeto idealizado. A validacao agora exige replay operacional, screenshots, snapshots antes/depois, contrato de snapshot por jornada, mutacao real de estado e side effects obrigatorios.

## O Que Existe

- Discovery Engine, Gap Detection Engine, Autonomous Gap Closure Engine e geradores automaticos de scenario/seed/UI step/validator.
- Operational State Engine, Transition Contracts, State Registry e Replay Validator.
- Rotas de QA Waves, QA Gaps, RPA Replays e Test Executions.
- Jornadas criticas mapeadas: `support_ticket_flow`, `fitness_customer_checkin` e `booking_flow`.

## O Que Foi Corrigido

- `api/services/qa/stateSnapshotService.js` passou a coletar snapshots operacionais de API, DB, UI via Playwright quando disponivel, replay, audit/event logs, access-control/device, CRM, support ticket, attendance/check-in e booking.
- `config/state-snapshot-contracts.json` foi criado com contratos antes/depois por jornada.
- `api/services/qa/operationalStateEngine.js` agora bloqueia `GO` sem mutacao real: `missing_real_state_mutation`.
- `api/services/qa/operationalReplayValidator.js` agora classifica replay ausente, replay nao operacional, replay sem screenshots e replay sem transicao como bloqueadores.
- `api/services/qaWavesExecutionService.js` anexa `beforeSnapshot`, `afterSnapshot`, `stateMutation`, `stateSnapshotContract`, `operationalValidation` e `operationalTimeline` aos replays QA Waves.
- `scripts/qa-waves-governance.js` passou a exigir replay operacional, snapshots, mutacao e contrato de snapshot.
- `/dev/rpa-replays` mostra timeline operacional com abas `Estados`, `Transições` e `Side Effects`, badge GO/NO_GO e evidência técnica.
- `/dev/qa-gaps` mostra `transitionCoverage`, `stateValidationCoverage`, `sideEffectCoverage`, `operationalConsequenceCoverage`, gaps de estado/transição e bloqueadores de governança.
- E2E de replay passou a exigir timeline operacional visível.

## Criterios GO/NO_GO

GO somente se:

- preflight real passou;
- execucao browser-first real ocorreu;
- replay operacional existe;
- screenshots existem;
- snapshot inicial e final foram coletados;
- mutacao real foi comprovada;
- side effects obrigatorios foram comprovados;
- contrato de transicao e contrato de snapshot passaram.

NO_GO obrigatorio para:

- `missing_operational_replay`;
- `replay_not_operational`;
- `replay_missing_state_transition`;
- `missing_real_state_mutation`;
- `snapshot_contract_failed`;
- `missing_operational_screenshots`;
- `validation_only_by_click`;
- selector ficticio, precondition fake, `test.skip`, fallback silencioso ou sucesso sem replay.

## Status Por Jornada

- `support_ticket_flow`: contrato e coleta implementados para ticket, mensagens, CRM activity e audit logs. A validacao real no Playwright ainda encontrou bloqueios de UI/dados: click interceptado por overlay, compositor ausente em ticket, ticket `in_progress` ausente e fluxo manual de suporte sem replayId.
- `fitness_customer_checkin`: contrato e coleta implementados para contact/subject, membership, credential, access decision, access event, attendance e CRM presence. Quando `deviceId` nao existe, a evidencia fica marcada como `simulated_device`; quando existe, fica `device_real_candidate`.
- `booking_flow`: contrato e coleta implementados para contagem e criacao de booking.

## Status Por Capability

O endpoint `/api/qa-waves/operational/summary` agora inclui `finalCoverage`, e `/dev/qa-gaps` exibe coverage por capability mais coverage operacional agregado. Capabilities sem replay, screenshot, estado ou side effect permanecem `NO_GO`.

## Status Por Transition

- `ticket_reply_transition`: exige ticket aberto, nova mensagem, CRM activity e audit log incrementados.
- `ticket_resolve_transition`: exige resolucao real e audit/CRM.
- `access_release_transition`: exige access decision allow, evento de liberacao, attendance/check-in e CRM presence.
- `booking_create_transition`: exige booking incrementado, CRM e audit.

## Status Por Replay

Replays QA Waves passam a carregar timeline com:

- estado inicial;
- acao executada;
- transicao;
- estado final;
- side effects;
- evidencia visual;
- evidencia tecnica.

No `/dev/rpa-replays`, cada step agora tambem exibe `motivo estrito` quando o status for `NO_GO`, usando os blockers/evidencias do proprio replay.

## Catalogo de Motivos Estritos (UI)

Os principais motivos normalizados mostrados no replay sao:

- `page_null_blocking_journey`: page Playwright ausente em jornada blocking.
- `browser_launch_failed`: browser real nao iniciou.
- `initial_navigation_failed`: URL inicial da jornada nao abriu.
- `blocking_step_missing_evidence`: step sem evidencia obrigatoria.
- `network_events_missing`: step sem eventos de rede associados.
- `mutation_linkage_missing`: step sem vinculo UI->rede->mutacao.
- `screenshot_before_capture_failed`: falha no screenshot antes da acao.
- `screenshot_after_capture_failed`: falha no screenshot depois da acao.
- `dom_snapshot_capture_failed`: falha na captura do DOM snapshot.
- `step_execution_failed`: erro direto no execute do step.
- `support_required_selector_missing`: selector critico ausente em support.
- `fitness_required_selector_missing`: selector critico ausente em fitness.

Se houver mais de um blocker, a UI mostra os motivos concatenados no mesmo card de step para auditoria rapida.

## Gaps Restantes

- O spec `frontend-e2e/support-agent-flow.spec.ts` revelou gaps reais de UX/dados operacionais, nao apenas falhas de teste: overlay interceptando clique, ticket sem composer, ticket `in_progress` ausente e operacao `/support` manual sem replay operacional emitido.
- `npm run qa:waves:governance` exige `--waveId`; o script npm atual nao fornece default.
- Nao existe script `npm run package` no `package.json`; a validacao de pacote foi feita via `./scripts/generate-zip.sh`.
- A coleta UI via Playwright depende de receber `page` no contexto; nas execucoes de backend sem browser acoplado, a evidencia UI fica marcada como indisponivel.

## Riscos

- Jornadas sem IDs de seed (`ticketId`, `subjectId`, `membershipId`, `credentialId`, `deviceId`) podem coletar ultimo registro do tenant como fallback de leitura, mas isso nao aprova GO sem mutacao e contrato.
- Replays antigos sem snapshots passam a ser `NO_GO` pela nova governanca.
- A ausencia de device real em fitness deve permanecer explicitamente simulada ate integracao fisica.

## Comandos Executados

- `npx jest api/services/__tests__/operationalStateEngine.test.js --runInBand`: passou.
- `npx jest api/services/__tests__/transitionInferenceService.test.js --runInBand`: passou.
- `npx jest api/services/__tests__/preflightEngine.strict.test.js --runInBand`: passou.
- `npx jest api/services/__tests__/autonomousGapClosureEngine.loop.test.js --runInBand`: passou.
- `npm run frontend:build`: passou, com aviso de chunk grande existente.
- `npm run clean:test-artifacts`: passou.
- `npm run qa:waves:analyze`: produziu relatorio, mas ficou com handles abertos e foi encerrado apos saida util.
- `npm run qa:waves:governance`: falhou por falta de `--waveId`.
- Tentativa de empacotamento via `npm run package`: falhou porque nao existe script; o fluxo valido foi `./scripts/generate-zip.sh`.
- `./scripts/generate-zip.sh --output-dir /tmp --name qa-waves-operational-review.zip`: passou e bloqueou conteudo proibido.
- `npx playwright test qa-waves-replay.spec.ts` em `frontend-e2e`: passou.
- `npx playwright test support-agent-flow.spec.ts` em `frontend-e2e`: falhou com gaps operacionais reais listados acima.

## Arquivos Alterados

- `api/services/qa/stateSnapshotService.js`
- `api/services/qa/operationalStateEngine.js`
- `api/services/qa/operationalReplayValidator.js`
- `api/services/qa/replayNormalizationService.js`
- `api/services/qaWavesExecutionService.js`
- `api/services/qaWavesOperationalService.js`
- `config/state-snapshot-contracts.json`
- `frontend/src/pages/RpaReplaysPage.jsx`
- `frontend/src/pages/QaGapsPage.jsx`
- `frontend-e2e/qa-waves-replay.spec.ts`
- `frontend-e2e/support-agent-flow.spec.ts`
- `scripts/qa-waves-governance.js`
- testes unitarios relacionados aos engines.
