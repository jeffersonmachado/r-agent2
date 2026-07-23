---
title: fitness/renovacao — Renovação E2E via WhatsApp de plano anual com cartão expirado, oferta de atualização de pagamento e confirmação de renovação sem duplicidade de cobrança
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ whatsapp"}
    step_004["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_005["validate_context\n📡 whatsapp\n⚙ whatsapp"]
    step_006["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_007["create_payment\n📡 whatsapp\n⚙ whatsapp"]
    step_008["validate_response\n📡 whatsapp\n⚙ whatsapp"]
    step_009("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_010["validate_backend\n📡 whatsapp\n⚙ api"]
    step_011["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_012["validate_response\n📡 whatsapp\n⚙ whatsapp"]
    step_013["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_014["validate_fallback\n📡 whatsapp\n⚙ whatsapp"]
    step_001 -->| "Cliente informa que recebeu aviso de vencimento e quer re..." | step_002
    step_002 -->| "Detectar intenção de renovação de plano (renovacao) e man..." | step_003
    step_003 -->| "Disponibilizar dados de contexto: plano atual = 'Anual', ..." | step_004
    step_004 -->| "O assistente confirma o plano atual e a data de venciment..." | step_005
    step_005 -->| "Cliente confirma que deseja renovar agora e pede para pag..." | step_006
    step_006 -->| "Gerar link de pagamento seguro para renovação do plano an..." | step_007
    step_007 -->| "O assistente envia o link de pagamento no WhatsApp com in..." | step_008
    step_008 -->| "Aguardar evento de confirmação de pagamento (payment_succ..." | step_009
    step_009 -->| "Após payment_succeeded: assinatura/contrato é renovado (n..." | step_010
    step_010 -->| "Transicionar do fluxo de pagamento para o fluxo de confir..." | step_011
    step_011 -->| "O assistente confirma no WhatsApp que a renovação foi con..." | step_012
    step_012 -->| "Tempo total até enviar o link de pagamento: <= 60s após s..." | step_013
    step_013 -->| "Se o pagamento não for confirmado em até 15 minutos, o as..." | step_014

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true