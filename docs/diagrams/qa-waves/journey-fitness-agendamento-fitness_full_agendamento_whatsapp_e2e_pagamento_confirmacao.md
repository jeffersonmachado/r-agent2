---
title: fitness/agendamento — E2E no WhatsApp: agendar aula (pilates) com escolha de unidade, checagem de elegibilidade, pagamento e confirmação com política de cancelamento
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_005["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_006["check_availability\n📡 whatsapp\n⚙ schedulingService"]
    step_007["select_slot\n📡 whatsapp\n⚙ schedulingService"]
    step_008["validate_backend\n📡 whatsapp\n⚙ api"]
    step_009["create_payment\n📡 whatsapp\n⚙ paymentService"]
    step_010("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_011["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_012["create_booking\n📡 whatsapp\n⚙ schedulingService"]
    step_013["validate_backend\n📡 whatsapp\n⚙ api"]
    step_014["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_015["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_016["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_001 -->| "Usuário solicita agendamento de aula de pilates para aman..." | step_002
    step_002 -->| "Assistente identifica intenção de agendamento de aula (pi..." | step_003
    step_003 -->| "Usuário informa: unidade (ex.: 'Unidade Paulista'), modal..." | step_004
    step_004 -->| "Assistente mantém contexto (modalidade=Pilates, unidade=P..." | step_005
    step_005 -->| "Assistente consulta disponibilidade para a unidade e jane..." | step_006
    step_006 -->| "Usuário escolhe um dos horários oferecidos (ex.: '20:00')..." | step_007
    step_007 -->| "Assistente valida elegibilidade: aluno ativo, sem bloquei..." | step_008
    step_008 -->| "Assistente apresenta valor final, formas de pagamento dis..." | step_009
    step_009 -->| "Assistente aguarda confirmação de pagamento (evento assín..." | step_010
    step_010 -->| "Evento de pagamento aprovado chega ao assistente (com ide..." | step_011
    step_011 -->| "Assistente converte a pré-reserva em agendamento confirma..." | step_012
    step_012 -->| "Backend registra booking confirmado com: unidade correta,..." | step_013
    step_013 -->| "Assistente envia confirmação no WhatsApp com: unidade, en..." | step_014
    step_014 -->| "Tempo total do fluxo até confirmação (excluindo espera po..." | step_015
    step_015 -->| "Após confirmar, assistente oferece próximos passos releva..." | step_016

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true