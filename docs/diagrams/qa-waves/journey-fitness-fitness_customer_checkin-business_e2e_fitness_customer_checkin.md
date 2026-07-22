---
title: fitness/fitness_customer_checkin — Check-in Completo de Aluno Fitness
---

```mermaid
flowchart LR
    step_fitness_customer_checkin_001["trigger_channel_event\n📡 whatsapp\n⚙ api"]
    step_fitness_customer_checkin_002["validate_backend\n📡 whatsapp\n⚙ api"]
    step_fitness_customer_checkin_003["validate_access_release\n📡 whatsapp\n⚙ api"]
    step_fitness_customer_checkin_004["validate_backend\n📡 whatsapp\n⚙ api"]
    step_fitness_customer_checkin_001 -->| "membershipActive, noPendingPayments, planValid" | step_fitness_customer_checkin_002
    step_fitness_customer_checkin_002 -->| "accessGranted, turnstileReleased, timestamp" | step_fitness_customer_checkin_003
    step_fitness_customer_checkin_003 -->| "attendanceRecorded, checkinTime, crmUpdated" | step_fitness_customer_checkin_004

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true