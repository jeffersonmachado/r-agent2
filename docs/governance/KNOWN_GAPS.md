# Known Gaps

## gap-proof-package-validation
- Severity: critical
- Area: package
- Title: ZIP de release nao contem todos os proofs obrigatorios
- Suggested fix: Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.

## gap-cross-report-package_mismatch
- Severity: critical
- Area: cross-report
- Title: Contradição cross-report: package_mismatch
- Suggested fix: Relatório de validação aponta para 'r-agent2-20260909-044512.payload.zip' mas o pacote atual é 'r-agent2-20260909-005443.payload.zip'. Governance vinculada a pacote errado — relatório inválido.

## gap-cross-report-package_validation_failed
- Severity: critical
- Area: cross-report
- Title: Contradição cross-report: package_validation_failed
- Suggested fix: Pacote não passou na validação: 0 entradas ausentes.
