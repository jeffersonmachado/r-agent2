# Known Gaps

## gap-enterprise-pbx-prod-like
- Severity: critical
- Area: pbx
- Title: PBX prod-like real ainda nao foi validado com replay de voz completo
- Suggested fix: Executar pbx_voice_flow_prod_like com originate, queue, IVR, TTS, ASR, DTMF, transfer, CDR e recording.

## gap-enterprise-omnichannel-unified-replay
- Severity: critical
- Area: omnichannel
- Title: Replay unificado omnichannel ainda nao possui prova operacional cross-channel
- Suggested fix: Gerar um replay unico cobrindo WhatsApp, chat, PBX, tickets, CRM e automacoes em uma mesma jornada do cliente.

## gap-proof-stale-fingerprints
- Severity: critical
- Area: proof-governance
- Title: Fingerprint chain divergente — codigo/cenarios/politicas mudaram apos o proof (STALE)
- Suggested fix: Regerar as evidencias e o proof sobre o codigo atual; proof STALE nunca conta como GO.

## gap-production-whatsapp
- Severity: medium
- Area: production-validation
- Title: Fluxo WhatsApp sem prova prod-like suficiente
- Suggested fix: Criar jornada com replay cronologico, assertions de backend e validacao de governanca para este fluxo.
