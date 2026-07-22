---
title: core/support_ticket_flow — Validação: Support Ticket Reply
---

```mermaid
flowchart LR
    step_cap_support_ticket_reply_1["validate_backend\n📡 api\n⚙ api"]
    step_cap_support_ticket_reply_2["validate_backend\n📡 api\n⚙ api"]
    step_cap_support_ticket_reply_1 -->| "dependenciesValid, deps" | step_cap_support_ticket_reply_2

```

- **Status**: approved
- **Canais**: api
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true