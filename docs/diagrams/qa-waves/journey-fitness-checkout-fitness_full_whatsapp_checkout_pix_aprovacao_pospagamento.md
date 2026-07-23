---
title: fitness/checkout — Checkout end-to-end no WhatsApp: compra de plano mensal + matrícula, pagamento via Pix, aprovação e liberação imediata de acesso
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_005["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_006["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_007["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_008["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_009("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_010["validate_backend\n📡 whatsapp\n⚙ api"]
    step_011["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_012["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_013["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_014["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_001 -->| "Usuário solicita fechar a compra do plano mensal com matr..." | step_002
    step_002 -->| "checkout_initiate" | step_003
    step_003 -->| "Assistente apresenta resumo do pedido (plano mensal + tax..." | step_004
    step_004 -->| "Fornecer nome completo, CPF válido, e-mail e aceitar term..." | step_005
    step_005 -->| "Contexto mantém itens do carrinho (plano mensal + matrícu..." | step_006
    step_006 -->| "Gerar cobrança Pix com valor exato do total, com QR Code/..." | step_007
    step_007 -->| "Assistente envia QR Code Pix (ou copia-e-cola), valor, pr..." | step_008
    step_008 -->| "Aguardar evento assíncrono de pagamento aprovado para a t..." | step_009
    step_009 -->| "Pedido muda para status 'paid/approved'; registrar transa..." | step_010
    step_010 -->| "Acesso liberado imediatamente após aprovação: status do m..." | step_011
    step_011 -->| "Assistente confirma pagamento aprovado, ativa o plano, in..." | step_012
    step_012 -->| "Encaminhar para pós-compra: oferecer agendar avaliação in..." | step_013
    step_013 -->| "Da confirmação do pagamento (evento) até a mensagem de ap..." | step_014

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true