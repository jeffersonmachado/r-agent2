---
title: fitness/cancelamento — Cancelamento E2E via WhatsApp com retenção, confirmação de identidade, efetivação imediata e liberação de acesso (alto risco)
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_005["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_006["validate_backend\n📡 whatsapp\n⚙ api"]
    step_007["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_008["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_009["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_010["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_011["validate_backend\n📡 whatsapp\n⚙ api"]
    step_012["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_013["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_014["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_015["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_001 -->| "Usuário solicita cancelamento da assinatura no WhatsApp u..." | step_002
    step_002 -->| "Detectar intenção de cancelamento de plano/assinatura e i..." | step_003
    step_003 -->| "Assistente deve explicar o que acontece ao cancelar (para..." | step_004
    step_004 -->| "Usuário informa e-mail cadastrado e CPF (ou últimos 4 díg..." | step_005
    step_005 -->| "Sistema valida que os dados correspondem a uma conta ativ..." | step_006
    step_006 -->| "Assistente apresenta tentativa de retenção específica (ex..." | step_007
    step_007 -->| "Usuário recusa retenção e confirma: 'Quero cancelar agora'." | step_008
    step_008 -->| "Fluxo transiciona para etapa de confirmação final de canc..." | step_009
    step_009 -->| "Usuário confirma explicitamente a ação final (ex.: 'Confi..." | step_010
    step_010 -->| "Assinatura é cancelada no provedor de billing (status can..." | step_011
    step_011 -->| "Acesso premium é ajustado conforme política: revogação im..." | step_012
    step_012 -->| "Assistente confirma cancelamento concluído, informa statu..." | step_013
    step_013 -->| "Todo o fluxo deve concluir sem encaminhar para humano, ma..." | step_014
    step_014 -->| "Contexto final deve registrar canal=whatsapp, intenção=ca..." | step_015

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true