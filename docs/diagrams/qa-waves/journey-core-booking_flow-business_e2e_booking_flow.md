---
title: core/booking_flow — Fluxo Completo de Agendamento
---

```mermaid
flowchart LR
    step_booking_flow_001["send_message\n📡 whatsapp\n⚙ api"]
    step_booking_flow_002["check_availability\n📡 whatsapp\n⚙ api"]
    step_booking_flow_003["select_slot\n📡 whatsapp\n⚙ api"]
    step_booking_flow_004["create_booking\n📡 whatsapp\n⚙ api"]
    step_booking_flow_005["validate_backend\n📡 whatsapp\n⚙ api"]
    step_booking_flow_001 -->| "slotsFound, availableSlots" | step_booking_flow_002
    step_booking_flow_002 -->| "slotSelected, timeConfirmed" | step_booking_flow_003
    step_booking_flow_003 -->| "bookingCreated, confirmationSent, reminderScheduled" | step_booking_flow_004
    step_booking_flow_004 -->| "crmUpdated, calendarSynced, notificationSent" | step_booking_flow_005

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true