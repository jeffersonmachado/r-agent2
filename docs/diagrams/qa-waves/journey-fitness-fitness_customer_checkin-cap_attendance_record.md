---
title: fitness/fitness_customer_checkin — Validação: Attendance Record
---

```mermaid
flowchart LR
    step_cap_attendance_record_1["validate_backend\n📡 api\n⚙ api"]
    step_cap_attendance_record_2["validate_backend\n📡 api\n⚙ api"]
    step_cap_attendance_record_1 -->| "dependenciesValid, deps" | step_cap_attendance_record_2

```

- **Status**: approved
- **Canais**: api
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true