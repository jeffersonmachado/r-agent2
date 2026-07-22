---
title: core/payment_charge_flow — Fluxo Completo de Cobrança e Pagamento
---

```mermaid
flowchart LR
    step_payment_charge_flow_001["validate_backend\n📡 whatsapp\n⚙ api"]
    step_payment_charge_flow_002["send_message\n📡 whatsapp\n⚙ api"]
    step_payment_charge_flow_003["create_payment\n📡 whatsapp\n⚙ api"]
    step_payment_charge_flow_004["validate_backend\n📡 whatsapp\n⚙ api"]
    step_payment_charge_flow_001 -->| "paymentLinkSent, messageDelivered" | step_payment_charge_flow_002
    step_payment_charge_flow_002 -->| "paymentProcessed, status, method" | step_payment_charge_flow_003
    step_payment_charge_flow_003 -->| "ledgerUpdated, subscriptionActive, receiptGenerated" | step_payment_charge_flow_004

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true