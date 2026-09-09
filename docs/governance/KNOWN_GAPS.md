# Known Gaps

## gap-proof-package-validation
- Severity: critical
- Area: package
- Title: ZIP de release nao contem todos os proofs obrigatorios
- Suggested fix: Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.

## gap-proof-invalid-artifact-semantics
- Severity: critical
- Area: proof-governance
- Title: Proof artifacts presentes mas semanticamente invalidos (presenca != validade)
- Suggested fix: Corrigir o conteudo dos artifacts (ok/valid/status, assertions, snapshots) e regerar as evidencias.

## gap-cross-report-package_validation_failed
- Severity: critical
- Area: cross-report
- Title: Contradição cross-report: package_validation_failed
- Suggested fix: Pacote não passou na validação: 0 entradas ausentes.
