# Known Gaps

## gap-proof-package-validation
- Severity: critical
- Area: package
- Title: ZIP de release nao contem todos os proofs obrigatorios
- Suggested fix: Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.

## gap-proof-stale-fingerprints
- Severity: critical
- Area: proof-governance
- Title: Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)
- Suggested fix: Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.

## gap-cross-report-package_validation_failed
- Severity: critical
- Area: cross-report
- Title: Contradição cross-report: package_validation_failed
- Suggested fix: Pacote não passou na validação: 0 entradas ausentes.
