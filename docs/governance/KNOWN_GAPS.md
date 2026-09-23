# Known Gaps

## gap-mesh-fitness-functional_failure-fitness-matricula-cancelamento-fitness-matricula-checkin-fitness-matricula-checkout-fitness-matricula-onboarding
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio fitness
- Suggested fix: Inspecionar o artefato do cenário e corrigir a causa raiz antes de reexecutar a wave.

## gap-mesh-core-flaky-business-core-biz-academy
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio core
- Suggested fix: Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.

## gap-mesh-core-flaky-business-core-biz-rag-segregation
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio core
- Suggested fix: Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.

## gap-mesh-fitness-flaky-fitness-matricula-agendamento-ui
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio fitness
- Suggested fix: Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.

## gap-mesh-omnichannel-infra_error-fitness-matricula-leads
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio omnichannel
- Suggested fix: Priorizar correção de browser/runtime/rede antes de investigar regra de negócio.

## gap-mesh-omnichannel-flaky-support-inbox-nota-ui
- Severity: high
- Area: qa-mesh
- Title: Falha aberta no dominio omnichannel
- Suggested fix: Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.

## gap-proof-stale-fingerprints
- Severity: critical
- Area: proof-governance
- Title: Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)
- Suggested fix: Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.
