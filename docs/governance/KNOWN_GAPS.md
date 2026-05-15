# Known Gaps

## gap-mesh-pbx-functional_failure-qa-pbx-call-events-runtime-smoke
- Severity: critical
- Area: qa-mesh
- Title: Falha aberta no dominio pbx
- Suggested fix: Inspecionar o artefato do cenário e corrigir a causa raiz antes de reexecutar a wave.

## gap-proof-package-validation
- Severity: critical
- Area: package
- Title: ZIP de release nao contem todos os proofs obrigatorios
- Suggested fix: Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.

## gap-proof-governance-support
- Severity: critical
- Area: proof-governance
- Title: Governance signature ou cleanup proof nao possuem artifact fisico valido
- Suggested fix: Persistir assinatura de governance com hashes e cleanup proof com limpeza validada.

## gap-cross-report-package_validation_failed
- Severity: critical
- Area: cross-report
- Title: Contradição cross-report: package_validation_failed
- Suggested fix: Pacote não passou na validação: 0 entradas ausentes.
