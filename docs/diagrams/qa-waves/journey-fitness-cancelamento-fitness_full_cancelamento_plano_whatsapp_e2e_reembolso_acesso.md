---
title: fitness/cancelamento — WhatsApp: cancelamento E2E de plano anual com cobrança recente, confirmação de identidade, cálculo de reembolso e bloqueio de acesso
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_005["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_006("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_007["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_008["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_009["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_010["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_011["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_012["validate_backend\n📡 whatsapp\n⚙ api"]
    step_013["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_014["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_015["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_016["validate_fallback\n📡 whatsapp\n⚙ api"]
    step_001 -->| "Cliente solicita cancelamento do plano via WhatsApp e men..." | step_002
    step_002 -->| "cancelamento_plano" | step_003
    step_003 -->| "Assistente confirma que pode ajudar a cancelar, informa q..." | step_004
    step_004 -->| "Cliente fornece dados de confirmação solicitados (ex.: CP..." | step_005
    step_005 -->| "Recebimento do evento de verificação/OTP validado com suc..." | step_006
    step_006 -->| "Assistente identifica corretamente: plano anual ativo, da..." | step_007
    step_007 -->| "Assistente apresenta opções claras: (1) cancelar ao fim d..." | step_008
    step_008 -->| "Cliente escolhe cancelamento imediato com reembolso propo..." | step_009
    step_009 -->| "Fluxo transita para etapa de confirmação final de cancela..." | step_010
    step_010 -->| "Cliente confirma novamente (sim) o cancelamento imediato ..." | step_011
    step_011 -->| "Cancelamento é registrado no backend com status 'canceled..." | step_012
    step_012 -->| "Acesso premium ao app/plataforma é removido após efetivaç..." | step_013
    step_013 -->| "Assistente confirma cancelamento concluído, informa data/..." | step_014
    step_014 -->| "Assistente informa SLA de reembolso compatível com alto r..." | step_015
    step_015 -->| "Se o reembolso não puder ser calculado automaticamente, a..." | step_016

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true