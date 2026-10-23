# Regularização de fechamentos sem prova

Gerado em 2026-10-23T02:26:29.587Z · commit `e747bac4c5c8e7d9a6807040197b6f6d7f1ce700` · fingerprint `5151d5b68487…`

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| REQUER_DECISAO_HUMANA | 12 |
| AGUARDA_INSUMOS_HUMANOS | 30 |
| AGUARDA_ASSINATURA_E_ANCORA | 88 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN | P0 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/waveEvidenceSameRunPreflight.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN.log |
| HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/qa-mesh/failureIntelligenceLineage.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING.log |
| HARDENING-ENG-GOV-RELEASE-P0-2 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/governanceChainCertification.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P0-2.log |
| HARDENING-ENG-GOV-RELEASE-P0-3 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/sealPhaseOrder.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P0-3.log |
| HARDENING-ENG-GOV-RELEASE-P0-4 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P0-4.log |
| HARDENING-ENG-GOV-RELEASE-P0-5 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/coverage/impactRunnerBinding.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P0-5.log |
| HARDENING-ENG-GOV-RELEASE-P0-6 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/releaseSuiteRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P0-6.log |
| HARDENING-ENG-GOV-RELEASE-P0-7 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/branchProtectionApplyPayload.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-P0-7.log |
| L1-CONCORRENCIA-HTTP-DUPLO-ACCEPT | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/integration/engineeringRouterConcurrentRunHttp.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-CONCORRENCIA-HTTP-DUPLO-ACCEPT.log |
| L1-WORKTREE-MUTILACAO-RECORRENTE | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/worktreeIntegrity.test.js | AI_MEMORY/evidence/bug-closure-regularization/L1-WORKTREE-MUTILACAO-RECORRENTE.log |
| MISSAO-B1-CADEIA-CRIPTOGRAFICA | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/bugClosureHistoricalGuards.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-B1-CADEIA-CRIPTOGRAFICA.log |
| P0-1 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/securityIntel/approvalAuthority.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-1.log |
| P0-2 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/evidenceManifestHashBaseline.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-2.log |
| P0-3 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/securityIntel/securityGateProvenance.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-3.log |
| P0-4 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/securityIntel/waiverService.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-4.log |
| P0-5 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/integration/securityWaiverApprovalE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-5.log |
| P0-AGREGADO-AUTORIZACAO-TARDIA-CADEIA-VAZIA-PASS | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/governanceEnforcementOrder.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-AGREGADO-AUTORIZACAO-TARDIA-CADEIA-VAZIA-PASS.log |
| P0-AVALIADOR-CONFIAVA-EM-CAMPO-VALID-GRAVADO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-AVALIADOR-CONFIAVA-EM-CAMPO-VALID-GRAVADO.log |
| P0-CADEIA-APARENCIA-DE-VALIDA-APOS-ALTERACAO | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/governanceChainAppearance.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-CADEIA-APARENCIA-DE-VALIDA-APOS-ALTERACAO.log |
| P0-CRM-UPSERT-TRANSFERE-PROPRIEDADE-ENTRE-TENANTS | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/integration/crmTenantIsolation.postgres.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-CRM-UPSERT-TRANSFERE-PROPRIEDADE-ENTRE-TENANTS.log |
| P0-ESTADO-E-VEREDITO-PODEM-DISCORDAR | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-ESTADO-E-VEREDITO-PODEM-DISCORDAR.log |
| P0-FALSO-GO-ESTADO-DE-GATE-NAO-PERMITIDO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/canonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-FALSO-GO-ESTADO-DE-GATE-NAO-PERMITIDO.log |
| P0-FILAS-ISOLAMENTO-TENANT | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/queueTenantIsolation.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-FILAS-ISOLAMENTO-TENANT.log |
| P0-FILAS-ROLLBACK-DESTRUTIVO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/queueCreatePersistBeforeResponse.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-FILAS-ROLLBACK-DESTRUTIVO.log |
| P0-GATE-ACEITA-COBERTURA-PARCIAL-DE-FASE | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/phaseStepContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-GATE-ACEITA-COBERTURA-PARCIAL-DE-FASE.log |
| P0-GATE-FASES-DUPLICADAS-DESCONHECIDAS-FALSO-PASS | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/devBranchGatePhaseContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-GATE-FASES-DUPLICADAS-DESCONHECIDAS-FALSO-PASS.log |
| P0-IDENTIDADE-AUSENTE-E-ACEITA-COMO-COERENTE | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-IDENTIDADE-AUSENTE-E-ACEITA-COMO-COERENTE.log |
| P0-PRODUTORES-GRAVAM-LINEAGE-SEM-SOURCECOMMIT | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/producerLineageIdentity.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-PRODUTORES-GRAVAM-LINEAGE-SEM-SOURCECOMMIT.log |
| P0-RISCO-ACEITO-DISPENSA-CONTROLE-CRITICO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/riskAcceptedCriticalControl.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-RISCO-ACEITO-DISPENSA-CONTROLE-CRITICO.log |
| P0-RUN-SEM-SOURCE-COMMIT-IDENTIDADE-DE-RELEASE-IMPOSSIVEL | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/runIdentityCommit.test.js | AI_MEMORY/evidence/bug-closure-regularization/P0-RUN-SEM-SOURCE-COMMIT-IDENTIDADE-DE-RELEASE-IMPOSSIVEL.log |
| AUDITORIA-ENTRYPOINT-TRAVAS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-ENTRYPOINT-TRAVAS.log |
| AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-FASE-B-TESTE-MUTAVA-EVIDENCIA-GOVERNADA.log |
| CI-ADAPTADOR-IA-NAO-VERSIONADO | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/aiGovernanceRequiredFilesTracked.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-ADAPTADOR-IA-NAO-VERSIONADO.log |
| CI-CHECKOUT-LIMPO-HARNESS | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/bugClosureHistoricalGuards.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-CHECKOUT-LIMPO-HARNESS.log |
| CI-RUNNER-COMPARTILHADO-ENTRE-ARVORES | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/officialTestScriptsNoVacuousPass.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-RUNNER-COMPARTILHADO-ENTRE-ARVORES.log |
| DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/effectiveAggregateChain.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA.log |
| DEF-QUEUE-DELETE-DB-ONLY | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/queueModuleRoutes.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-QUEUE-DELETE-DB-ONLY.log |
| DEF-REMOVECHILD-HEADER-ENHANCEMENT | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | frontend/src/__tests__/supportHeaderEnhancement.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-REMOVECHILD-HEADER-ENHANCEMENT.log |
| DEF-TEARDOWN-DRAIN-WORKER | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/governanceApprovalFullWorkerE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-TEARDOWN-DRAIN-WORKER.log |
| DEF-WS-AUTH-POS-LOGIN | P1 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | frontend/src/context/__tests__/WebSocketContext.loginAuth.test.jsx | AI_MEMORY/evidence/bug-closure-regularization/DEF-WS-AUTH-POS-LOGIN.log |
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
| AUDITORIA-FASE-B-FALSO-POSITIVO-SCANNER-FILA | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/jsonPersistenceNoPhantomWrite.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-FASE-B-FALSO-POSITIVO-SCANNER-FILA.log |
| CI-FLOW-GATE-VACUOSO | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/officialTestScriptsNoVacuousPass.test.js | AI_MEMORY/evidence/bug-closure-regularization/CI-FLOW-GATE-VACUOSO.log |
| DEF-TIMEBOMB-EVOSYNC-JANELA30D | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/evoSyncIntegration.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-TIMEBOMB-EVOSYNC-JANELA30D.log |
| DIV-PUREZA-ENGINE | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/engine/enginePurityPorts.test.js | AI_MEMORY/evidence/bug-closure-regularization/DIV-PUREZA-ENGINE.log |
| H12-RAG-REPARO | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/ragIndexHealthPolicy.test.js | AI_MEMORY/evidence/bug-closure-regularization/H12-RAG-REPARO.log |
| H16-MUTACAO-SUPERFICIE-NO-RUN | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/allValidatorsRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/H16-MUTACAO-SUPERFICIE-NO-RUN.log |
| H17-PREFLIGHT-ASK-AI-TTL | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/askAiRuntimeEvidenceTtlPreflight.test.js | AI_MEMORY/evidence/bug-closure-regularization/H17-PREFLIGHT-ASK-AI-TTL.log |
| H20-RUN-ORFAO-PROJECAO-STALE | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/convergenceFixpoint.test.js | AI_MEMORY/evidence/bug-closure-regularization/H20-RUN-ORFAO-PROJECAO-STALE.log |
| H21-CRM-PERSISTENCIA-X-METRICAS | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/crmRealtimeEvents.test.js | AI_MEMORY/evidence/bug-closure-regularization/H21-CRM-PERSISTENCIA-X-METRICAS.log |
| H9-IDENTIDADE-PORTA | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/dev/devServicesSupervision.test.js | AI_MEMORY/evidence/bug-closure-regularization/H9-IDENTIDADE-PORTA.log |
| HARDENING-ENG-GOV-RELEASE-AGREGADO-EXIGE-WORKTREE-CONGELADO | P2 | RESOLVED | REQUER_DECISAO_HUMANA | — | — |
| HARDENING-ENG-GOV-RELEASE-AUDITORIA-GIT-ENTRYPOINT | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-AUDITORIA-GIT-ENTRYPOINT.log |
| HARDENING-ENG-GOV-RELEASE-PONTEIROS-CLOSURE-ORFAOS | P2 | RESOLVED | REQUER_DECISAO_HUMANA | — | — |
| HARDENING-ENG-GOV-RELEASE-RUNTIME-EVIDENCE-DIAGNOSTICO-ENGANOSO | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/runtimeEvidenceDiagnosis.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-RUNTIME-EVIDENCE-DIAGNOSTICO-ENGANOSO.log |
| HARDENING-ENG-GOV-RELEASE-SBOM-RUN-WINDOW | P2 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/taskLeaseHandshakeParsing.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-SBOM-RUN-WINDOW.log |
| HARDENING-ENG-GOV-RELEASE-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/jsonPersistenceNoPhantomWrite.test.js | AI_MEMORY/evidence/bug-closure-regularization/HARDENING-ENG-GOV-RELEASE-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE.log |
| MISSAO-B5-VINCULO-DEFEITO-PREVENCAO | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/evoSyncIntegration.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-B5-VINCULO-DEFEITO-PREVENCAO.log |
| MISSAO-B8-ESTADOS-FILA | P2 | RESOLVED | REQUER_DECISAO_HUMANA | — | — |
| N5-REENTREGA | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/integration/missionSourceStaleReplanFullRouterE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/N5-REENTREGA.log |
| P2-1 | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/remoteProvenanceAuthority.test.js | AI_MEMORY/evidence/bug-closure-regularization/P2-1.log |
| P2-2 | P2 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/reportWriteLineage.test.js | AI_MEMORY/evidence/bug-closure-regularization/P2-2.log |
| P2-TESTES-REGRAVAM-EVIDENCIA-GOVERNADA-TEMPORAL | P2 | RESOLVED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/governedArtifactPreservation.test.js | AI_MEMORY/evidence/bug-closure-regularization/P2-TESTES-REGRAVAM-EVIDENCIA-GOVERNADA-TEMPORAL.log |
| AUDITORIA-BRANCH-INVENTORY | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/branchInventory.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-BRANCH-INVENTORY.log |
| AUDITORIA-CHECKPOINT-PROTOCOL | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/checkpointTool.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-CHECKPOINT-PROTOCOL.log |
| AUDITORIA-FASE-B-CADEIA-FORA-DO-AGREGADO | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/audit/auditEntrypointArtifact.test.js | AI_MEMORY/evidence/bug-closure-regularization/AUDITORIA-FASE-B-CADEIA-FORA-DO-AGREGADO.log |
| DEF-STATESYNC-EXEMPTION-STALE | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/frontend/stateSyncExemptionExactness.test.js | AI_MEMORY/evidence/bug-closure-regularization/DEF-STATESYNC-EXEMPTION-STALE.log |
| H18-JORNADA-FUNCIONAL-BROWSER | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/governance/journeyDetectors.test.js | AI_MEMORY/evidence/bug-closure-regularization/H18-JORNADA-FUNCIONAL-BROWSER.log |
| MISSAO-A-L1-IMPACTO | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/coverage/impactGraph.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-A-L1-IMPACTO.log |
| MISSAO-A-L2-L3-ORQUESTRADOR | P3 | VERIFIED | AGUARDA_ASSINATURA_E_ANCORA | tests/unit/coverage/impactRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/MISSAO-A-L2-L3-ORQUESTRADOR.log |
| MISSAO-B3-REUSO-PROVENIENCIA | P3 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| MISSAO-B4-REVISAO-INDEPENDENTE | P3 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |
| MISSAO-DEMO-SELF-ENGINEERING | P3 | VERIFIED | REQUER_DECISAO_HUMANA | — | — |

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

