# QA Waves Operational Proof Architecture

## Objetivo

O RAP QA Waves valida jornadas operacionais contínuas com prova causal determinística. O GO técnico operacional só pode ser emitido quando a evidência classificada como `operational` comprova, por step, que uma ação real no browser causou efeitos reais em estado, rede e side effects esperados.

`stateMutation` global é permitido apenas como resumo de jornada, sempre com `evidenceClassification: "journey_summary_only"`. Ele nunca é prova de mutationLinkage, provenance, side effect proof ou step proof.

## Diagrama Temporal

```text
step
-> beforeStepSnapshot
-> browser action
-> expectedNetworkEvent
-> afterStepSnapshot
-> incrementalDiff
-> observedMutations
-> observedSideEffects
-> mutationLinkage
-> provenance
-> replay
-> governance
```

## 1. Execution Proof

Cada step operacional precisa carregar evidência real de execução: URL, selector, screenshots before/after, DOM quando aplicável, network events e `stepResult`. A prova de execução é avaliada antes da prova de estado e não pode inferir mutações.

## 2. Entity-Scoped Snapshots

Snapshots são coletados por escopo de entidade do step. O snapshot antes e depois precisa representar a entidade operacional afetada, como ticket, mensagens, CRM, audit log, attendance, AccessDecision ou AccessEvent.

## 3. Incremental Step Diff

O diff válido é sempre incremental por step: `beforeStepSnapshot` contra `afterStepSnapshot`. Diff global da jornada não produz mutação operacional e só pode aparecer como resumo/auditoria.

## 4. Deterministic Provenance

Cada mutation observada precisa de provenance com `originatingStepId`, `originatingActionType`, `originatingNetworkEvent`, `entityScope` e hashes dos snapshots before/after. A correlação válida usa apenas o expectedNetworkEvent do registry.

## 5. Exact Mutation Matching

Mutation matching é exato. IDs canônicos como `message_created`, `ticket_status_changed`, `attendance_created`, `access_decision_created`, `crm_updated` e `audit_log_created` não aceitam aliases, regex, prefixos ou matching parcial.

## 6. Exact Side Effect Matching

Side effects também são comparados por igualdade exata. Um side effect esperado só é satisfeito quando o valor observado é exatamente o mesmo valor canônico do contrato.

## 7. Operational vs Diagnostic Evidence

`evidenceClassification: "operational"` é a única evidência que conta para GO.

`evidenceClassification: "diagnostic_only"` pode existir para inspeção e troubleshooting, mas é ignorada pela governança operacional. Se só houver evidência diagnóstica, o resultado é `REVIEW`, nunca `GO`.

`evidenceClassification: "journey_summary_only"` identifica resumos globais como `stateMutation`; esse material não pode ser usado como prova de step.

## 8. Governance GO/NO_GO

GO exige prova operacional determinística completa. NO_GO ocorre quando falta evidência operacional obrigatória, snapshots, network event esperado, mutation/side effect exato, provenance válida ou quando aparece `journey_transition`/heurística como prova operacional.

REVIEW é reservado para evidência diagnóstica sem prova operacional suficiente.

## 9. Causal Proof Chain

A proof chain é causal quando o replay mostra:

- browser action real;
- expectedNetworkEvent encontrado por método, endpoint e status válido;
- afterStepSnapshot posterior ao step;
- incrementalDiff real;
- observedMutations e observedSideEffects canônicos;
- mutationLinkage nascido após o incrementalDiff;
- provenance determinística ligada ao network event esperado.

## 10. Temporal Proof Pipeline

Pipeline operacional obrigatório:

1. `collectStepBeforeSnapshot()`
2. `executeStep()`
3. `validateStepExecutionProof()`
4. `collectStepAfterSnapshot()`
5. `computeIncrementalStepDiff()`
6. `deriveObservedMutations()`
7. `deriveObservedSideEffects()`
8. `buildMutationLinkage()`
9. `validatePostStateProof()`
10. `appendProofChainToReplay()`
11. `validateOperationalReplay()`

Qualquer mutationLinkage declarativo, linkage vindo de `stateMutation`, `journey_transition` em `operational_go`, heuristic evidence ou proof global de jornada bloqueia GO.
