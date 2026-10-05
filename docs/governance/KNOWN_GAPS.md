# Known Gaps

## gap-mesh-core-functional_failure-business-core-biz-flows-editor
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio core
- Suggested fix: Inspecionar o artefato do cenário e corrigir a causa raiz antes de reexecutar a wave.

## current_run_temporal_integrity
- Severity: critical
- Area: governance
- Title: Evidência autoritativa pré-run não pode sustentar a decisão do run
- Suggested fix: npm run ensure:authoritative-artifacts-fresh && npm run validate:current-run-temporal-integrity
