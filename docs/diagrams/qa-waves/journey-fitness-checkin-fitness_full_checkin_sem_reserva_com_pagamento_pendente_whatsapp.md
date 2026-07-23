---
title: fitness/checkin — Check-in via WhatsApp sem reserva ativa e com pagamento pendente: orientar, bloquear entrada e oferecer regularização
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_005["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_006["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_007["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_008("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_009["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_010["validate_backend\n📡 whatsapp\n⚙ api"]
    step_011["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_012["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_013["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_001 -->| "Cliente envia: \"Cheguei na Paulista, quero fazer meu chec..." | step_002
    step_002 -->| "Detectar intenção de check-in (entrada na academia/unidade)." | step_003
    step_003 -->| "Backend indica: cliente tem plano ativo, porém mensalidad..." | step_004
    step_004 -->| "Assistente confirma unidade (Paulista) e informa que há p..." | step_005
    step_005 -->| "Ao cliente responder que deseja pagar, o assistente gera ..." | step_006
    step_006 -->| "Resposta com link de pagamento deve ocorrer em até 10 seg..." | step_007
    step_007 -->| "Aguardar evento de confirmação de pagamento (webhook) por..." | step_008
    step_008 -->| "Receber evento de pagamento aprovado para a cobrança gera..." | step_009
    step_009 -->| "Backend atualiza status financeiro para 'em dia' e elegib..." | step_010
    step_010 -->| "Assistente confirma pagamento aprovado e informa que o ac..." | step_011
    step_011 -->| "Fluxo deve transicionar de 'checkin_bloqueado_por_pagamen..." | step_012
    step_012 -->| "Manter no contexto: unidade=Academia Central - Unidade Pa..." | step_013

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true