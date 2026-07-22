---
title: core/support_ticket_flow — Fluxo Completo de Ticket de Suporte
---

```mermaid
flowchart LR
    step_support_ticket_flow_001["send_message\n📡 whatsapp\n⚙ api"]
    step_support_ticket_flow_002{"validate_intent\n📡 whatsapp\n⚙ api"}
    step_support_ticket_flow_003("wait_for_event\n📡 whatsapp\n⚙ api")
    step_support_ticket_flow_004["send_message\n📡 whatsapp\n⚙ api"]
    step_support_ticket_flow_005["validate_backend\n📡 whatsapp\n⚙ api"]
    step_support_ticket_flow_006["send_message\n📡 whatsapp\n⚙ api"]
    step_support_ticket_flow_007["validate_flow_transition\n📡 whatsapp\n⚙ api"]
    step_support_ticket_flow_001 -->| "ticketCreated, ticketStatus, priority" | step_support_ticket_flow_002
    step_support_ticket_flow_002 -->| "agentNotified, ticketAssigned" | step_support_ticket_flow_003
    step_support_ticket_flow_003 -->| "replySent, messageDelivered" | step_support_ticket_flow_004
    step_support_ticket_flow_004 -->| "ticketUpdated, lastReply, slaOk" | step_support_ticket_flow_005
    step_support_ticket_flow_005 -->| "messageReceived, satisfactionPositive" | step_support_ticket_flow_006
    step_support_ticket_flow_006 -->| "ticketStatus, resolutionTime" | step_support_ticket_flow_007

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true