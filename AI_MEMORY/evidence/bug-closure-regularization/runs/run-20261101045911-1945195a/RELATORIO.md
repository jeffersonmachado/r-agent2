# Regularização de fechamentos sem prova

Gerado em 2026-11-01T05:01:46.276Z · commit `f4122cc89d078ead01a16658a2e0a21fd50af83f` · fingerprint `85fb543ba3a3…`
Execução `run-20261101045911-1945195a` · escopo **PARCIAL** · processados 31 de 31 · cobertura **PARCIAL** (não cobre o inventário)

> **Não autoritativo.** Este relatório descreve trabalho de re-verificação. A fila oficial não foi
> alterada por este script, e nenhuma prova foi assinada: a assinatura é do dono da chave ancorada.

## Resumo

| Classe | Itens |
|---|---|
| AGUARDA_INSUMOS_HUMANOS | 30 |
| AMBIENTE_INDISPONIVEL | 1 |

## Itens

| Defeito | Sev | Estado declarado | Classe | Teste | Log |
|---|---|---|---|---|---|
| HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/releaseArtifactIdentity.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN.log |
| HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/waveEvidenceSameRunPreflight.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN.log |
| HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/qa-mesh/failureIntelligenceLineage.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING.log |
| HARDENING-ENG-GOV-RELEASE-P0-2 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/governanceChainCertification.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-P0-2.log |
| HARDENING-ENG-GOV-RELEASE-P0-3 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/sealPhaseOrder.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-P0-3.log |
| HARDENING-ENG-GOV-RELEASE-P0-4 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-P0-4.log |
| HARDENING-ENG-GOV-RELEASE-P0-5 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/coverage/impactRunnerBinding.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-P0-5.log |
| HARDENING-ENG-GOV-RELEASE-P0-6 | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/releaseSuiteRunner.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-P0-6.log |
| HARDENING-ENG-GOV-RELEASE-P0-7 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/branchProtectionApplyPayload.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/HARDENING-ENG-GOV-RELEASE-P0-7.log |
| L1-CONCORRENCIA-HTTP-DUPLO-ACCEPT | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/integration/engineeringRouterConcurrentRunHttp.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/L1-CONCORRENCIA-HTTP-DUPLO-ACCEPT.log |
| L1-WORKTREE-MUTILACAO-RECORRENTE | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/worktreeIntegrity.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/L1-WORKTREE-MUTILACAO-RECORRENTE.log |
| MISSAO-B1-CADEIA-CRIPTOGRAFICA | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/bugClosureHistoricalGuards.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/MISSAO-B1-CADEIA-CRIPTOGRAFICA.log |
| P0-1 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/securityIntel/approvalAuthority.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-1.log |
| P0-2 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/evidenceManifestHashBaseline.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-2.log |
| P0-3 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/securityIntel/securityGateProvenance.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-3.log |
| P0-4 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/securityIntel/waiverService.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-4.log |
| P0-5 | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/integration/securityWaiverApprovalE2E.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-5.log |
| P0-AGREGADO-AUTORIZACAO-TARDIA-CADEIA-VAZIA-PASS | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/governanceEnforcementOrder.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-AGREGADO-AUTORIZACAO-TARDIA-CADEIA-VAZIA-PASS.log |
| P0-AVALIADOR-CONFIAVA-EM-CAMPO-VALID-GRAVADO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-AVALIADOR-CONFIAVA-EM-CAMPO-VALID-GRAVADO.log |
| P0-CADEIA-APARENCIA-DE-VALIDA-APOS-ALTERACAO | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/governanceChainAppearance.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-CADEIA-APARENCIA-DE-VALIDA-APOS-ALTERACAO.log |
| P0-CRM-UPSERT-TRANSFERE-PROPRIEDADE-ENTRE-TENANTS | P0 | VERIFIED | AMBIENTE_INDISPONIVEL | tests/integration/crmTenantIsolation.postgres.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-CRM-UPSERT-TRANSFERE-PROPRIEDADE-ENTRE-TENANTS.log |
| P0-ESTADO-E-VEREDITO-PODEM-DISCORDAR | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-ESTADO-E-VEREDITO-PODEM-DISCORDAR.log |
| P0-FALSO-GO-ESTADO-DE-GATE-NAO-PERMITIDO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/canonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-FALSO-GO-ESTADO-DE-GATE-NAO-PERMITIDO.log |
| P0-FILAS-ISOLAMENTO-TENANT | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/queueTenantIsolation.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-FILAS-ISOLAMENTO-TENANT.log |
| P0-FILAS-ROLLBACK-DESTRUTIVO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/queueCreatePersistBeforeResponse.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-FILAS-ROLLBACK-DESTRUTIVO.log |
| P0-GATE-ACEITA-COBERTURA-PARCIAL-DE-FASE | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/phaseStepContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-GATE-ACEITA-COBERTURA-PARCIAL-DE-FASE.log |
| P0-GATE-FASES-DUPLICADAS-DESCONHECIDAS-FALSO-PASS | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/devBranchGatePhaseContract.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-GATE-FASES-DUPLICADAS-DESCONHECIDAS-FALSO-PASS.log |
| P0-IDENTIDADE-AUSENTE-E-ACEITA-COMO-COERENTE | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/assertCanonicalReleaseDecision.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-IDENTIDADE-AUSENTE-E-ACEITA-COMO-COERENTE.log |
| P0-PRODUTORES-GRAVAM-LINEAGE-SEM-SOURCECOMMIT | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/producerLineageIdentity.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-PRODUTORES-GRAVAM-LINEAGE-SEM-SOURCECOMMIT.log |
| P0-RISCO-ACEITO-DISPENSA-CONTROLE-CRITICO | P0 | VERIFIED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/riskAcceptedCriticalControl.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-RISCO-ACEITO-DISPENSA-CONTROLE-CRITICO.log |
| P0-RUN-SEM-SOURCE-COMMIT-IDENTIDADE-DE-RELEASE-IMPOSSIVEL | P0 | RESOLVED | AGUARDA_INSUMOS_HUMANOS | tests/unit/governance/runIdentityCommit.test.js | AI_MEMORY/evidence/bug-closure-regularization/runs/run-20261101045911-1945195a/logs/P0-RUN-SEM-SOURCE-COMMIT-IDENTIDADE-DE-RELEASE-IMPOSSIVEL.log |

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

