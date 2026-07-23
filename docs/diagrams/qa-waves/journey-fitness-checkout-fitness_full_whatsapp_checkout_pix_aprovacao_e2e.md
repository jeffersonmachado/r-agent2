---
title: fitness/checkout — WhatsApp checkout completo: compra de plano mensal com cupom, PIX, aprovação e liberação imediata de acesso no app
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ whatsapp"}
    step_004["validate_response\n📡 whatsapp\n⚙ whatsapp"]
    step_005["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_006["validate_response\n📡 whatsapp\n⚙ whatsapp"]
    step_007["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_008{"validate_intent\n📡 whatsapp\n⚙ whatsapp"}
    step_009["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_010["validate_response\n📡 whatsapp\n⚙ whatsapp"]
    step_011("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_012["validate_backend\n📡 whatsapp\n⚙ api"]
    step_013["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_014["validate_response\n📡 whatsapp\n⚙ whatsapp"]
    step_015["validate_context\n📡 whatsapp\n⚙ whatsapp"]
    step_016["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_001 -->| "Usuário solicita assinatura do plano mensal com objetivo ..." | step_002
    step_002 -->| "checkout_start" | step_003
    step_003 -->| "Bot apresenta opções de planos (mensal/anual) com preços,..." | step_004
    step_004 -->| "Selecionar plano mensal e informar que possui cupom de de..." | step_005
    step_005 -->| "Bot valida o cupom, confirma desconto aplicado, apresenta..." | step_006
    step_006 -->| "Confirmar o resumo e escolher pagamento via PIX." | step_007
    step_007 -->| "checkout_select_payment_pix" | step_008
    step_008 -->| "Sistema gera cobrança PIX (QR Code e código copia-e-cola)..." | step_009
    step_009 -->| "Bot envia QR Code/PIX copia-e-cola, valor final, validade..." | step_010
    step_010 -->| "Receber evento de confirmação de pagamento PIX aprovado p..." | step_011
    step_011 -->| "Pedido deve transitar para status 'paid/approved', gerar ..." | step_012
    step_012 -->| "Acesso premium é liberado imediatamente (flag de entitlem..." | step_013
    step_013 -->| "Bot confirma pagamento aprovado, informa data de início e..." | step_014
    step_014 -->| "Contexto final deve refletir: plano mensal selecionado, c..." | step_015
    step_015 -->| "Tempo total entre geração do PIX e confirmação ao usuário..." | step_016

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true