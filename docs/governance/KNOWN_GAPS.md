# Known Gaps

## gap-proof-stale-fingerprints
- Severity: critical
- Area: proof-governance
- Title: Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)
- Suggested fix: Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.

## current_run_temporal_integrity
- Severity: critical
- Area: governance
- Title: Evidência autoritativa pré-run não pode sustentar a decisão do run
- Suggested fix: npm run ensure:authoritative-artifacts-fresh && npm run validate:current-run-temporal-integrity
