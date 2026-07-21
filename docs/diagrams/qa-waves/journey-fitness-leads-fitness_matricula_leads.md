---
title: fitness/leads — Captação de Lead via WhatsApp
---

```mermaid
flowchart LR
    step_001["Cliente envia mensagem WhatsApp\n📡 whatsapp\n⚙ whatsapp"]
    step_002["Sistema recebe inbound WhatsApp\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"IA classifica intenção do cliente\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["Sistema decide roteamento: bot ou humano\n📡 whatsapp\n⚙ flowEngine"]
    step_005["Bot gera e envia resposta ao cliente\n📡 whatsapp\n⚙ ragService"]
    step_006["Validar criação do lead no backend\n📡 whatsapp\n⚙ api"]
    step_007["Validar SLA de resposta ao lead\n📡 whatsapp\n⚙ meshValidator"]
    step_001 -->| "eventType, conversationCreated" | step_002
    step_002 -->| "intent, confidenceMin" | step_003
    step_003 -->| "routingDecision, nextNode" | step_004
    step_004 -->| "semantic, responseDelivered" | step_005
    step_005 -->| "backendEntity, leadCreated, fields" | step_006
    step_006 -->| "withinSla" | step_007

```

- **Status**: approved
- **Canais**: whatsapp
- **Risco**: medium
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true