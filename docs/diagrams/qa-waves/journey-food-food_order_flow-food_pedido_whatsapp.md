---
title: food/food_order_flow — Food pedido via WhatsApp até confirmação
---

```mermaid
flowchart LR
    step_food_001["Pedido recebido via WhatsApp webhook\n📡 whatsapp\n⚙ whatsapp"]
    step_food_002["Status do pedido atualizado\n⚙ api"]
    step_food_001 -->| "backendEntity, statusUpdated" | step_food_002

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: high
- **Pré-condições**: Módulo de pedidos ativo; Tenant autenticado
- **Validações**: replay=true, backend=true