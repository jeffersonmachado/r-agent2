---
title: fitness/renovacao — Renovação de plano via WhatsApp com falha de pagamento no cartão, recuperação com PIX e confirmação de renovação sem duplicidade
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_005["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_006["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_007["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_008["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_009("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_010["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_011["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_012["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_013["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_014("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_015["validate_backend\n📡 whatsapp\n⚙ api"]
    step_016["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_017["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_018["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_001 -->| "Usuário solicita renovação do plano mensal e pede para ma..." | step_002
    step_002 -->| "Sistema identifica intenção de renovação de assinatura/pl..." | step_003
    step_003 -->| "Assistente recupera e confirma dados do cliente: plano at..." | step_004
    step_004 -->| "Assistente apresenta opções de renovação específicas (mes..." | step_005
    step_005 -->| "Usuário confirma manter o mesmo plano e escolhe pagar com..." | step_006
    step_006 -->| "Usuário informa dados mínimos necessários para pagamento ..." | step_007
    step_007 -->| "Sistema gera cobrança para renovação (cartão) e retorna l..." | step_008
    step_008 -->| "Sistema aguarda evento assíncrono do gateway indicando fa..." | step_009
    step_009 -->| "Assistente comunica falha de pagamento com motivo genéric..." | step_010
    step_010 -->| "Usuário escolhe PIX: 'Pode ser no PIX então'." | step_011
    step_011 -->| "Sistema gera cobrança PIX para a mesma renovação (sem dup..." | step_012
    step_012 -->| "Assistente informa tempo esperado para confirmação do PIX..." | step_013
    step_013 -->| "Sistema recebe evento do gateway confirmando pagamento PI..." | step_014
    step_014 -->| "Backend atualiza assinatura: renovação aplicada com nova ..." | step_015
    step_015 -->| "Acesso do cliente é mantido/estendido imediatamente após ..." | step_016
    step_016 -->| "Assistente confirma renovação concluída, informa novo per..." | step_017
    step_017 -->| "Fluxo encerra em estado de 'renovação concluída' com cont..." | step_018

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true