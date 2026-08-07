# Known Gaps

## gap-mesh-registry-scope-mismatch
- Severity: critical
- Area: qa-mesh
- Title: Canonical GO usa registry parcial do workspace-core
- Suggested fix: Executar o gate canonical contra o meshRegistry completo e bloquear GO enquanto registryTotal for menor que o registry declarado.

## gap-proof-package-validation
- Severity: critical
- Area: package
- Title: ZIP de release nao contem todos os proofs obrigatorios
- Suggested fix: Regenerar o pacote com todos os artifacts auditaveis e revalidar o ZIP fisico.
