# Known Gaps

## gap-mesh-core-flaky-business-core-biz-login
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio core
- Suggested fix: Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.

## gap-proof-stale-fingerprints
- Severity: critical
- Area: proof-governance
- Title: Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)
- Suggested fix: Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.
