---
title: fitness/fitness_customer_checkin — Validação: Membership Validation
---

```mermaid
flowchart LR
    step_cap_membership_validation_1["validate_backend\n📡 api\n⚙ api"]
    step_cap_membership_validation_2["validate_backend\n📡 api\n⚙ api"]
    step_cap_membership_validation_1 -->| "dependenciesValid, deps" | step_cap_membership_validation_2

```

- **Status**: approved
- **Canais**: api
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true