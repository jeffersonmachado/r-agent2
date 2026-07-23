---
title: fitness/checkout — WhatsApp: checkout completo de plano mensal com PIX e confirmação de matrícula (E2E) para academia
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_005["check_availability\n📡 whatsapp\n⚙ schedulingService"]
    step_006["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_007["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_008["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_009["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_010("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_011["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_012["validate_backend\n📡 whatsapp\n⚙ api"]
    step_013["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_014["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_015["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_016["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_001 -->| "Usuário solicita contratação de plano mensal e informa in..." | step_002
    step_002 -->| "checkout_initiate_plan_subscription_pix" | step_003
    step_003 -->| "Usuário informa a unidade desejada (ex.: 'Unidade Paulist..." | step_004
    step_004 -->| "Plataforma valida disponibilidade do plano mensal na unid..." | step_005
    step_005 -->| "Bot apresenta resumo do pedido com valores detalhados (me..." | step_006
    step_006 -->| "Usuário confirma o resumo e prossegue: 'Confirmo, pode ge..." | step_007
    step_007 -->| "Sistema gera cobrança PIX com QR Code (imagem) e/ou códig..." | step_008
    step_008 -->| "Contexto do checkout mantém: plano=mensal, unidade seleci..." | step_009
    step_009 -->| "Aguardar notificação de pagamento aprovado (webhook/event..." | step_010
    step_010 -->| "Receber evento de pagamento aprovado associado ao mesmo i..." | step_011
    step_011 -->| "Backend registra pagamento como 'aprovado' para o pedido ..." | step_012
    step_012 -->| "Acesso liberado: usuário recebe confirmação de matrícula/..." | step_013
    step_013 -->| "Mensagem final no WhatsApp confirma: pagamento aprovado, ..." | step_014
    step_014 -->| "Fluxo transita de 'checkout' para 'pos_compra/onboarding'..." | step_015
    step_015 -->| "Confirmação pós-pagamento enviada no WhatsApp em até 60s ..." | step_016

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true