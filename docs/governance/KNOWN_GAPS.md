# Known Gaps

## gap-proof-stale-fingerprints
- Severity: critical
- Area: proof-governance
- Title: Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)
- Suggested fix: Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.

## gap-proof-human-handoff
- Severity: high
- Area: human-handoff
- Title: Human handoff nao possui prova fisica enterprise completa
- Suggested fix: Normalizar timestamps, assignedTo, eventCount, replay e mutacoes de backend.

## gap-proof-omnichannel-replay
- Severity: high
- Area: omnichannel
- Title: Replay omnichannel unificado nao possui prova fisica completa
- Suggested fix: Persistir transicoes cross-channel, eventos WhatsApp/chat/PBX/ticket e mutacoes CRM.

## gap-proof-digital-twin
- Severity: high
- Area: digital-twin
- Title: Operational Digital Twin nao possui prova fisica completa
- Suggested fix: Persistir snapshots, assertions, mutations e timeline fisica do twin operacional.
