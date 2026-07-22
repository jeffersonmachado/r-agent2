---
title: fitness/fitness_customer_checkin — Validação: Crm Update
---

```mermaid
flowchart LR
    step_cap_crm_update_1["validate_backend\n📡 api\n⚙ api"]
    step_cap_crm_update_2["validate_backend\n📡 api\n⚙ api"]
    step_cap_crm_update_1 -->| "dependenciesValid, deps" | step_cap_crm_update_2

```

- **Status**: approved
- **Canais**: api
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true