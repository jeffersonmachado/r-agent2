# Known Gaps

## gap-mesh-pbx-functional_failure-qa-pbx-call-events-runtime-smoke
- Severity: critical
- Area: qa-mesh
- Title: Falha aberta no dominio pbx
- Suggested fix: Inspecionar o artefato do cenário e corrigir a causa raiz antes de reexecutar a wave.

## gap-mesh-fitness-flaky-business-f1
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio fitness
- Suggested fix: Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.

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
