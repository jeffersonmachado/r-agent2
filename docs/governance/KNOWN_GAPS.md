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

## gap-proof-invalid-artifact-semantics
- Severity: critical
- Area: proof-governance
- Title: Proof artifacts presentes mas semanticamente invalidos (presenca != validade)
- Suggested fix: Corrigir o conteudo dos artifacts (ok/valid/status, assertions, snapshots) e regerar as evidencias.

## gap-proof-pbx-prod-like
- Severity: high
- Area: pbx
- Title: PBX prod-like — maturidade atual: hybrid-real
- Suggested fix: Remover synthetic_insert e corrigir selftestStatus para upgrade para prod-like/enterprise-real.

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

## gap-cross-report-pbx_maturity_insufficient
- Severity: critical
- Area: cross-report
- Title: Contradição cross-report: pbx_maturity_insufficient
- Suggested fix: PBX classificado como 'hybrid-real'. Para enterprise-ready PBX deve ser prod-like ou enterprise-real. Presença de synthetic_insert ou selftestStatus=FAIL impede upgrade.

## gap-production-whatsapp
- Severity: medium
- Area: production-validation
- Title: Fluxo WhatsApp sem prova prod-like suficiente
- Suggested fix: Criar jornada com replay cronologico, assertions de backend e validacao de governanca para este fluxo.
