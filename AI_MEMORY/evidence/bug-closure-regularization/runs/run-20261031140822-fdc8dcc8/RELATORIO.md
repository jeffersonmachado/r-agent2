# Regularização de fechamentos sem prova

Gerado em 2026-10-31T14:23:23.210Z · commit `078737b84fbd9f53fc0401d5f89280e1cc4de541` · fingerprint `9cc1970b0909…`
Execução `run-20261031140822-fdc8dcc8` · escopo **PARCIAL** · processados 78 de 78 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_ASSINATURA_E_ANCORA | 69 |
| REQUER_DECISAO_HUMANA | 7 |
| TESTE_FALHOU_AGORA | 2 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| AUDITORIA-ENTRYPOINT-TRAVAS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-ENTRYPOINT-TRAVAS.log |
| AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA.log |
| CI-ADAPTADOR-IA-NAO-VERSIONADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/aiGovernanceRequiredFilesTracked.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-ADAPTADOR-IA-NAO-VERSIONADO.log |
| CI-CHECKOUT-LIMPO-HARNESS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/bugClosureHistoricalGuards.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-CHECKOUT-LIMPO-HARNESS.log |
| CI-E2E-CREDENTIAL-SCOPE | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-E2E-CREDENTIAL-SCOPE.log |
| CI-MAIN-JEST-AMBIENTE | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| CI-RUNNER-COMPARTILHADO-ENTRE-ARVORES | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/officialTestScriptsNoVacuousPass.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-RUNNER-COMPARTILHADO-ENTRE-ARVORES.log |
| CI-WAVE-REFRESH-SEM-RUN-GOVERNADO | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/effectiveAggregateChain.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA.log |
| DEF-QUEUE-DELETE-DB-ONLY | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/queueModuleRoutes.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-QUEUE-DELETE-DB-ONLY.log |
| DEF-REMOVECHILD-HEADER-ENHANCEMENT | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | frontend/src/__tests__/supportHeaderEnhancement.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-REMOVECHILD-HEADER-ENHANCEMENT.log |
| DEF-TEARDOWN-DRAIN-WORKER | P1 | VERIFIED | TESTE_FALHOU_AGORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-TEARDOWN-DRAIN-WORKER.log |
| DEF-WS-AUTH-POS-LOGIN | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | frontend/src/context/__tests__/WebSocketContext.loginAuth.test.jsx | AI_MEMORY/evidence/bug-closure-regularization/DEF-WS-AUTH-POS-LOGIN.log |
| E2E-REPLAY-DOMINIO-E-TAB | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/backfillRegressionTests.test.js | AI_MEMORY/evidence/bug-closure-regularization/E2E-REPLAY-DOMINIO-E-TAB.log |
| ENG-LEASE-FENCE-NAO-VALIDADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/ENG-LEASE-FENCE-NAO-VALIDADO.log |
| ENG-PROVENIENCIA-REPRODUCAO-SOBRESCRITA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoop.test.js | AI_MEMORY/evidence/bug-closure-regularization/ENG-PROVENIENCIA-REPRODUCAO-SOBRESCRITA.log |
| ENG-RECONCILIACAO-BOOT-STARVATION | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringMissionSourceE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/ENG-RECONCILIACAO-BOOT-STARVATION.log |
| ENG-RECONCILIACAO-STARVATION-HEAD-ESTACIONARIO | P1 | VERIFIED | TESTE_FALHOU_AGORA | tests/integration/engineeringMissionSourceE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/ENG-RECONCILIACAO-STARVATION-HEAD-ESTACIONARIO.log |
| FASE6-NOVO-CANDIDATO-POR-MUDANCA-DE-FINGERPRINT | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| H10-VEREDITO-GATE-SEGURANCA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/securityGateState.test.js | AI_MEMORY/evidence/bug-closure-regularization/H10-VEREDITO-GATE-SEGURANCA.log |
| H11-ESCOPO-DIFERIDO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringRouter/taskContractScope.test.js | AI_MEMORY/evidence/bug-closure-regularization/H11-ESCOPO-DIFERIDO.log |
| H13-RUNNER-COMPLETO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/allValidatorsRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/H13-RUNNER-COMPLETO.log |
| H14-CDR-SUPERVISIONADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/pbx/pbxCdrHealth.test.js | AI_MEMORY/evidence/bug-closure-regularization/H14-CDR-SUPERVISIONADO.log |
| H15-CDR-LAST-FAIL | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/pbx/pbxCdrHealth.test.js | AI_MEMORY/evidence/bug-closure-regularization/H15-CDR-LAST-FAIL.log |
| H16-V2SEAL-PASSO-SEM-MOTIVO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/v2SealStepDiagnostics.test.js | AI_MEMORY/evidence/bug-closure-regularization/H16-V2SEAL-PASSO-SEM-MOTIVO.log |
| H17-HOOKS-EDITOR | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | frontend/src/components/FlowTemplateSelector.test.jsx | AI_MEMORY/evidence/bug-closure-regularization/H17-HOOKS-EDITOR.log |
| HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/aggregateVerdict.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO.log |
| HARDENING-ENG-GOV-RELEASE-HANDSHAKE-AMBIGUO | P1 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/taskLeaseHandshakeParsing.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-HANDSHAKE-AMBIGUO.log |
| HARDENING-ENG-GOV-RELEASE-HANDSHAKE-FENCE-UNDEFINED | P1 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/taskLeaseHandshakeParsing.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-HANDSHAKE-FENCE-UNDEFINED.log |
| HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/qa-mesh/meshZeroResultsPromotion.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA.log |
| HARDENING-ENG-GOV-RELEASE-P1-11 | P1 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/evidenceTtl.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P1-11.log |
| JOURNEY-STORE-ESCONDE-DERIVADAS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | api/services/__tests__/qaWavesService.journey.test.js | AI_MEMORY/evidence/bug-closure-regularization/JOURNEY-STORE-ESCONDE-DERIVADAS.log |
| L1-CONTEXTO-FONTE-NAO-MATERIALIZAVEL | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringRouterContextSourceFailClosed.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-CONTEXTO-FONTE-NAO-MATERIALIZAVEL.log |
| L1-ENTREGA-VERIFICADA-SEM-VERIFICACAO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/releaseStateService.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-ENTREGA-VERIFICADA-SEM-VERIFICACAO.log |
| L1-L2-JORNADA-SUPERVISIONADA-MEDIDA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringMissionFullE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-L2-JORNADA-SUPERVISIONADA-MEDIDA.log |
| L1-NPM-TEST-CI-VERMELHO | P1 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/qaMeshOperationPolicy.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-NPM-TEST-CI-VERMELHO.log |
| L1-PUBLISH-TAG-EXIGE-VERIFICACAO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/devGovernanceModels.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-PUBLISH-TAG-EXIGE-VERIFICACAO.log |
| L1-RUNNER-CONTAINER-MODULE-NOT-FOUND | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringRunnerDockerfileClosure.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-RUNNER-CONTAINER-MODULE-NOT-FOUND.log |
| L1-RUNTIME-EVIDENCE-NAO-REPRODUZIVEL | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| MISSAO-B9-CI-GITHUB-ACTIONS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/devBranchCiGate.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-B9-CI-GITHUB-ACTIONS.log |
| P1-1 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMission/testSuiteClassifier.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-1.log |
| P1-10 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringRouterProviderChainPolicy.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-10.log |
| P1-11 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/v2SealOrchestration.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-11.log |
| P1-12 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/evidenceFreshness.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-12.log |
| P1-13 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/smokeEvidenceSummary.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-13.log |
| P1-15 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/attestationOrder.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-15.log |
| P1-16 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/releaseSuiteRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-16.log |
| P1-17 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/securityIntel/securityGateProvenance.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-17.log |
| P1-2 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMissionReviewEngines.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-2.log |
| P1-3 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMission/deriveGatesEvidence.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-3.log |
| P1-4 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMission/activePreventiveRules.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-4.log |
| P1-5 | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| P1-6 | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| P1-7 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/securityIntel/triageRemediation.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-7.log |
| P1-8 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/qa/systemInventoryIntegrity.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-8.log |
| P1-9 | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/evidenceContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-9.log |
| P1-BRANCHES-MISSAO-RESIDUO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/pruneEngineeringMissionBranches.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-BRANCHES-MISSAO-RESIDUO.log |
| P1-CDR-HEALTH-SIGPIPE-PIPEFAIL | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/pbx/pbxCdrHealthSigpipe.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-CDR-HEALTH-SIGPIPE-PIPEFAIL.log |
| P1-CI-SEM-INTEGRACAO | P1 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| P1-CONCORRENCIA-EXIGE-POSTGRES | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringRouterConcurrentRunHttp.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-CONCORRENCIA-EXIGE-POSTGRES.log |
| P1-CRM-EDICAO-CRIA-DUPLICATA-E-RESPOSTA-AMBIGUA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/crmOpportunityUpdate.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-CRM-EDICAO-CRIA-DUPLICATA-E-RESPOSTA-AMBIGUA.log |
| P1-CRM-POLLING-EM-VEZ-DE-PUSH-E-ISOLAMENTO-WS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/realtimeTenantIsolation.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-CRM-POLLING-EM-VEZ-DE-PUSH-E-ISOLAMENTO-WS.log |
| P1-ENTREGA-EXIT-CODE-DESCARTAOO-GREP-COMO-AUTORIDADE | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/deliveryVerification.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-ENTREGA-EXIT-CODE-DESCARTAOO-GREP-COMO-AUTORIDADE.log |
| P1-EVIDENCIA-COMMIT-ORFAO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/hardeningQueueCommitExists.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-EVIDENCIA-COMMIT-ORFAO.log |
| P1-GATE-PRONTIDAO-EXECUTAVEL | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/engineerSupervisedReadinessGate.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-GATE-PRONTIDAO-EXECUTAVEL.log |
| P1-GUARDA-SKIP-ASSERTIONS-COMMITS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/worktreeIntegrity.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-GUARDA-SKIP-ASSERTIONS-COMMITS.log |
| P1-L0-INDETERMINISTA-POR-CONTENCAO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/ciGateL0Determinism.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-L0-INDETERMINISTA-POR-CONTENCAO.log |
| P1-LINEAGE-RUN-MAIS-RECENTE | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/reportLineageExplicit.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-LINEAGE-RUN-MAIS-RECENTE.log |
| P1-MERGE-MISSAO-PERDA-DE-ATUALIZACAO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringMissionMergeConcurrency.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-MERGE-MISSAO-PERDA-DE-ATUALIZACAO.log |
| P1-PATCH-SYMLINK-ESCAPE | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringRouterPatchSymlinkEscape.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-PATCH-SYMLINK-ESCAPE.log |
| P1-PROJECAO-GRAVADA-ANTES-DA-DECISAO-FINAL-JANELA-ABERTA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/projectionSyncOnCanonicalWrite.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-PROJECAO-GRAVADA-ANTES-DA-DECISAO-FINAL-JANELA-ABERTA.log |
| P1-REVISAO-INDEPENDENCIA-SO-NEGATIVA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMission/missionGatesEvidence.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-REVISAO-INDEPENDENCIA-SO-NEGATIVA.log |
| P1-SANDBOX-PROBE-CACHE-NEGATIVO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringRouterSandboxAvailabilityCache.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-SANDBOX-PROBE-CACHE-NEGATIVO.log |
| P1-SELO-PUSH-ORIGIN-MAIN-NO-OP-FALSO-PUSH-OK | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/deliveryVerification.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-SELO-PUSH-ORIGIN-MAIN-NO-OP-FALSO-PUSH-OK.log |
| P1-STAGING-DIST-GOVERNANCE-ARTIFACTS-DERRUBA-VALIDATE-DIST | P1 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/devBranchCiGate.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-STAGING-DIST-GOVERNANCE-ARTIFACTS-DERRUBA-VALIDATE-DIST.log |
| P1-UNIT-GATE-ACEITA-UNKNOWN | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engineeringMission/missionGatesEvidence.test.js | AI_MEMORY/evidence/bug-closure-regularization/P1-UNIT-GATE-ACEITA-UNKNOWN.log |
| RESUME-SUBSTITUTA-SEM-ESCOPO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/engineeringBugLoopNaturalPathE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/RESUME-SUBSTITUTA-SEM-ESCOPO.log |
| V2-EVIDENCIA-REAL-NO-HEAD | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/V2-EVIDENCIA-REAL-NO-HEAD.log |

## Leitura das classes

- `AGUARDA_ASSINATURA_E_ANCORA` — teste re-executado com sucesso no HEAD, artefato de saída
  gravado com sha256, prova montada e estruturalmente válida. Falta **apenas** a assinatura
  Ed25519 da autoridade ancorada (e as âncoras externas provisionadas no ambiente).
- `AGUARDA_INSUMOS_HUMANOS` — teste re-executado com sucesso; falta `negativeEvidence`/
  `humanAuthorization` (P0), que são declarações humanas e não podem ser geradas aqui.
- `TESTE_FALHOU_AGORA` — a correção declarada não se sustenta no código atual ⇒ candidato a REABRIR.
- `AMBIENTE_INDISPONIVEL` — o teste exigiu infraestrutura ausente (ex.: Postgres); não é veredito.
- `REQUER_AJUSTE_DE_MODELO` — estado persistido (RESOLVED/RISK_ACCEPTED) sem transição canônica de fechamento.
- `REQUER_DECISAO_HUMANA` — nenhum teste de regressão citado/existente: reabrir ou aceitar risco.
- `ESTRUTURA_INCOMPLETA` — prova montada mas algo estrutural falhou; ver `provasAusentes`.

