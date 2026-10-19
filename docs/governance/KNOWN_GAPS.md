# Known Gaps

## gap-mesh-omnichannel-infra_error-fitness-matricula-leads
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio omnichannel
- Suggested fix: Priorizar correção de browser/runtime/rede antes de investigar regra de negócio.

## gap-proof-governance-support
- Severity: critical
- Area: proof-governance
- Title: Governance signature ou cleanup proof nao possuem artifact fisico valido
- Suggested fix: Persistir assinatura de governance com hashes e cleanup proof com limpeza validada.

## current_run_temporal_integrity
- Severity: critical
- Area: governance
- Title: Evidência autoritativa pré-run não pode sustentar a decisão do run
- Suggested fix: npm run ensure:authoritative-artifacts-fresh && npm run validate:current-run-temporal-integrity
