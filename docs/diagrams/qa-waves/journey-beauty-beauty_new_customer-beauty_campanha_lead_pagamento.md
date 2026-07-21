---
title: beauty/beauty_new_customer — Beauty campanha de unhas até pagamento
---

```mermaid
flowchart LR
    step_b1_001["Campanha criada e publicada\n📡 whatsapp\n⚙ api"]
    step_b1_002["Pagamento confirmado e status ativo\n⚙ api"]
    step_b1_001 -->| "backendEntity, paymentConfirmed" | step_b1_002

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: high
- **Pré-condições**: Campanha e sandbox billing habilitados
- **Validações**: replay=true, backend=true