---
title: fitness/fitness_customer_checkin — Validação: Turnstile Release
---

```mermaid
flowchart LR
    step_cap_turnstile_release_1["validate_backend\n⚙ api"]
    step_cap_turnstile_release_2["validate_backend\n⚙ api"]
    step_cap_turnstile_release_1 -->| "dependenciesValid, deps" | step_cap_turnstile_release_2

```

- **Status**: draft_ai
- **Canais**: api
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true