---
title: fitness/agendamento — WhatsApp: agendar avaliação física com personal, validar disponibilidade, pagamento antecipado e confirmação com política de cancelamento
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_005["check_availability\n📡 whatsapp\n⚙ schedulingService"]
    step_006["select_slot\n📡 whatsapp\n⚙ schedulingService"]
    step_007["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_008["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_009["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_010["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_011["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_012("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_013["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_014["create_booking\n📡 whatsapp\n⚙ schedulingService"]
    step_015["validate_backend\n📡 whatsapp\n⚙ api"]
    step_016["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_017["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_018["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_001 -->| "Usuário solicita agendamento de avaliação física com pers..." | step_002
    step_002 -->| "Identificar intenção principal como agendamento de serviç..." | step_003
    step_003 -->| "Coletar unidade desejada e restrições: usuário informa \"U..." | step_004
    step_004 -->| "Consultar agenda para avaliação física na Unidade Paulist..." | step_005
    step_005 -->| "Usuário seleciona um horário específico dentre os retorna..." | step_006
    step_006 -->| "Coletar dados mínimos obrigatórios para reserva: nome com..." | step_007
    step_007 -->| "Sistema valida formato dos dados (CPF com dígitos, e-mail..." | step_008
    step_008 -->| "Informar que a avaliação exige pagamento antecipado (valo..." | step_009
    step_009 -->| "Usuário confirma que quer pagar agora e solicita o link: ..." | step_010
    step_010 -->| "Gerar e enviar o link de pagamento em até 30 segundos apó..." | step_011
    step_011 -->| "Aguardar evento de pagamento aprovado por até 10 minutos,..." | step_012
    step_012 -->| "Receber evento externo: pagamento aprovado para a cobranç..." | step_013
    step_013 -->| "Criar a reserva definitiva para o slot selecionado vincul..." | step_014
    step_014 -->| "Confirmar no backend: status da reserva = confirmada, ser..." | step_015
    step_015 -->| "Enviar confirmação no WhatsApp com: data/hora, unidade/en..." | step_016
    step_016 -->| "Ao usuário perguntar \"Qual é o código?\", o sistema retorn..." | step_017
    step_017 -->| "Encerrar o fluxo de agendamento oferecendo próximos passo..." | step_018

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true